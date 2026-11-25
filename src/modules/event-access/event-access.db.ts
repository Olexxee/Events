import { createHash, randomBytes } from "node:crypto";
import { AppError } from "../../shared/errors/app-error.js";
import { getPrismaClient } from "../../infrastructure/database/prisma.js";

const prisma = getPrismaClient();
const digest = (token: string) => createHash("sha256").update(token).digest("hex");
const fail = (code: string, message: string, status = 409): never => {
  throw new AppError(code, message, status);
};

async function activeEvent(tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0], eventId: string) {
  const event = await tx.event.findUnique({
    where: { id: eventId },
    include: { schedules: true, organization: { select: { status: true } }, accessHold: true }
  });
  if (!event || event.status === "DRAFT") fail("EVENT_NOT_FOUND", "Event was not found", 404);
  if (event.status === "CANCELLED" || event.status === "COMPLETED" || event.organization.status !== "ACTIVE")
    fail("EVENT_ACCESS_CLOSED", "Event access is not available");
  if (event.moderationStatus !== "CLEAR") fail("EVENT_ACCESS_RESTRICTED", "Event access is restricted", 403);
  if (event.accessHold && !event.accessHold.releasedAt) fail("EVENT_ACCESS_ON_HOLD", "Event access is temporarily restricted", 403);
  const endsAt = event.schedules.reduce<Date | null>((latest, item) => !latest || item.endsAt > latest ? item.endsAt : latest, null);
  if (!endsAt || endsAt <= new Date()) fail("EVENT_ACCESS_CLOSED", "The event access window has ended");
  return { event, grantExpiry: endsAt };
}

async function assertManager(tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0], organizationId: string, eventId: string, userId: string) {
  const membership = await tx.organizationMembership.findUnique({
    where: { organizationId_userId: { organizationId, userId } },
    select: { role: true, status: true, organization: { select: { status: true } } }
  });
  if (!membership || membership.status !== "ACTIVE" || !["OWNER", "ADMIN"].includes(membership.role) || membership.organization.status !== "ACTIVE")
    fail("EVENT_ACCESS_FORBIDDEN", "Active organization owners or admins may manage event access", 403);
  const approval = await tx.organizerApplication.findFirst({
    where: { organizationId, status: "APPROVED" }, select: { id: true }
  });
  if (!approval) fail("ORGANIZER_APPROVAL_REQUIRED", "The organization is not approved to manage events", 403);
  const event = await tx.event.findFirst({ where: { id: eventId, organizationId }, select: { id: true } });
  if (!event) fail("EVENT_NOT_FOUND", "Event was not found", 404);
}

async function createGrant(tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0], input: {
  eventId: string; organizationId: string; userId: string;
  source: "INVITATION" | "ACCESS_REQUEST" | "PLATFORM"; sourceId: string; expiresAt: Date;
}) {
  const existing = await tx.eventAccessGrant.findFirst({
    where: { eventId: input.eventId, userId: input.userId, status: "ACTIVE", expiresAt: { gt: new Date() } }
  });
  if (existing) return existing;
  const grant = await tx.eventAccessGrant.create({
    data: { ...input, canViewDetails: true, canCheckout: true }
  });
  await tx.outboxMessage.create({
    data: {
      aggregateType: "event_access_grant", aggregateId: grant.id,
      eventType: "EventAccessGranted", deduplicationKey: `event.access.granted:${grant.id}`,
      payload: { eventId: input.eventId, userId: input.userId, grantId: grant.id }
    }
  });
  return grant;
}

export async function submitRequest(eventId: string, userId: string, message?: string) {
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: userId }, select: { status: true } });
    if (!user || user.status !== "ACTIVE") fail("ACCOUNT_INACTIVE", "An active account is required", 403);
    const { event } = await activeEvent(tx, eventId);
    if (event.accessPolicy !== "APPROVAL_REQUIRED") fail("ACCESS_REQUEST_NOT_ALLOWED", "This event does not accept access requests", 400);
    if (event.visibility === "INVITATION_ONLY") fail("INVITATION_REQUIRED", "This event requires an organizer invitation", 403);
    const existingGrant = await tx.eventAccessGrant.findFirst({
      where: { eventId, userId, status: "ACTIVE", expiresAt: { gt: new Date() } }, select: { id: true }
    });
    if (existingGrant) fail("ACCESS_ALREADY_GRANTED", "You already have access to this event");
    const request = await tx.eventAccessRequest.create({
      data: { eventId, organizationId: event.organizationId, requesterUserId: userId, ...(message ? { message } : {}) },
      select: { id: true, eventId: true, status: true, message: true, createdAt: true }
    });
    await tx.auditLog.create({ data: { actorId: userId, actorType: "user", action: "event.access.requested", resourceType: "event_access_request", resourceId: request.id } });
    return request;
  });
}

export async function myAccess(eventId: string, userId: string) {
  return prisma.$transaction(async (tx) => {
    const { event } = await activeEvent(tx, eventId);
    const grant = await tx.eventAccessGrant.findFirst({
      where: { eventId, userId, status: "ACTIVE", expiresAt: { gt: new Date() } },
      select: { id: true, canViewDetails: true, canCheckout: true, expiresAt: true, source: true }
    });
    const request = await tx.eventAccessRequest.findFirst({
      where: { eventId, requesterUserId: userId },
      orderBy: { createdAt: "desc" },
      select: { id: true, status: true, message: true, decisionReason: true, createdAt: true }
    });
    const invitation = await tx.eventInvitation.findFirst({
      where: { eventId, recipientUserId: userId, status: "PENDING", expiresAt: { gt: new Date() } },
      select: { id: true, expiresAt: true }
    });
    const allowedWithoutGrant = event.visibility !== "INVITATION_ONLY" && event.accessPolicy === "OPEN";
    return {
      eventId, visibility: event.visibility, accessPolicy: event.accessPolicy,
      canViewDetails: allowedWithoutGrant || Boolean(grant?.canViewDetails),
      canCheckout: event.accessPolicy === "OPEN" && event.visibility !== "INVITATION_ONLY" || Boolean(grant?.canCheckout),
      grant, request, pendingInvitation: Boolean(invitation)
    };
  });
}

export async function withdrawRequest(requestId: string, userId: string) {
  return prisma.$transaction(async (tx) => {
    const changed = await tx.eventAccessRequest.updateMany({
      where: { id: requestId, requesterUserId: userId, status: "SUBMITTED" },
      data: { status: "WITHDRAWN", withdrawnAt: new Date() }
    });
    if (changed.count !== 1) fail("ACCESS_REQUEST_NOT_WITHDRAWABLE", "The request does not exist or is no longer pending", 404);
    await tx.auditLog.create({ data: { actorId: userId, actorType: "user", action: "event.access.request.withdrawn", resourceType: "event_access_request", resourceId: requestId } });
    return { id: requestId, status: "WITHDRAWN" as const };
  });
}

export async function listRequests(eventId: string, organizationId: string, actorId: string) {
  return prisma.$transaction(async (tx) => {
    await assertManager(tx, organizationId, eventId, actorId);
    return tx.eventAccessRequest.findMany({
      where: { eventId, organizationId, status: "SUBMITTED" },
      select: {
        id: true, status: true, message: true, createdAt: true,
        requester: { select: { id: true, email: true, profile: { select: { displayName: true } } } }
      },
      orderBy: { createdAt: "asc" }, take: 100
    });
  });
}

export async function decideRequest(input: { requestId: string; organizationId: string; eventId: string; actorId: string; decision: "APPROVED" | "REJECTED"; reason: string }) {
  return prisma.$transaction(async (tx) => {
    await assertManager(tx, input.organizationId, input.eventId, input.actorId);
    const { event, grantExpiry } = await activeEvent(tx, input.eventId);
    if (event.accessPolicy !== "APPROVAL_REQUIRED" || event.visibility === "INVITATION_ONLY")
      fail("ACCESS_REQUEST_POLICY_CHANGED", "This event no longer accepts access requests");
    const request = await tx.eventAccessRequest.findFirst({
      where: { id: input.requestId, eventId: input.eventId, organizationId: input.organizationId, status: "SUBMITTED" }
    });
    if (!request) fail("ACCESS_REQUEST_NOT_REVIEWABLE", "The request is missing or no longer pending", 404);
    const changed = await tx.eventAccessRequest.updateMany({
      where: { id: request.id, status: "SUBMITTED" },
      data: { status: input.decision, decisionReason: input.reason, decidedByUserId: input.actorId, decidedAt: new Date() }
    });
    if (changed.count !== 1) fail("ACCESS_REQUEST_NOT_REVIEWABLE", "The request has already been decided");
    if (input.decision === "APPROVED") {
      await createGrant(tx, { eventId: event.id, organizationId: event.organizationId, userId: request.requesterUserId, source: "ACCESS_REQUEST", sourceId: request.id, expiresAt: grantExpiry });
    }
    await tx.auditLog.create({ data: { actorId: input.actorId, actorType: "user", action: `event.access.request.${input.decision.toLowerCase()}`, resourceType: "event_access_request", resourceId: request.id, metadata: { reason: input.reason } } });
    return { id: request.id, status: input.decision };
  });
}

export async function issueInvitation(input: { eventId: string; organizationId: string; actorId: string; recipientEmail: string; expiresInDays?: number }) {
  const rawToken = randomBytes(32).toString("base64url");
  const tokenDigest = digest(rawToken);
  const result = await prisma.$transaction(async (tx) => {
    await assertManager(tx, input.organizationId, input.eventId, input.actorId);
    const { event } = await activeEvent(tx, input.eventId);
    const recipient = await tx.user.findUnique({
      where: { email: input.recipientEmail.toLowerCase() },
      select: { id: true, emailVerifiedAt: true, status: true }
    });
    if (!recipient || !recipient.emailVerifiedAt || recipient.status !== "ACTIVE")
      fail("INVITATION_RECIPIENT_UNAVAILABLE", "A verified, active Events account is required", 400);
    const expiresAt = new Date(Math.min(Date.now() + Math.min(input.expiresInDays ?? 7, 7) * 86400000, Math.max(...event.schedules.map((s) => s.endsAt.getTime()))));
    if (expiresAt <= new Date()) fail("EVENT_ACCESS_CLOSED", "The event access window has ended");
    const invitation = await tx.eventInvitation.create({
      data: { eventId: event.id, organizationId: event.organizationId, recipientUserId: recipient.id, issuedByUserId: input.actorId, tokenDigest, expiresAt },
      select: { id: true, eventId: true, status: true, expiresAt: true }
    });
    await tx.auditLog.create({ data: { actorId: input.actorId, actorType: "user", action: "event.access.invitation.issued", resourceType: "event_invitation", resourceId: invitation.id, metadata: { recipientUserId: recipient.id } } });
    return invitation;
  });
  return { invitation: result, token: rawToken };
}

export async function respondToInvitation(token: string, userId: string, decision: "ACCEPTED" | "DECLINED") {
  return prisma.$transaction(async (tx) => {
    const invitation = await tx.eventInvitation.findUnique({ where: { tokenDigest: digest(token) } });
    if (!invitation || invitation.recipientUserId !== userId) fail("INVITATION_INVALID", "Invitation is invalid or unavailable", 404);
    if (invitation.status !== "PENDING" || invitation.expiresAt <= new Date()) fail("INVITATION_INVALID", "Invitation is invalid or unavailable", 404);
    const recipient = await tx.user.findUnique({ where: { id: userId }, select: { status: true, emailVerifiedAt: true } });
    if (!recipient || recipient.status !== "ACTIVE" || !recipient.emailVerifiedAt) fail("ACCOUNT_VERIFICATION_REQUIRED", "A verified active account is required", 403);
    const { event, grantExpiry } = await activeEvent(tx, invitation.eventId);
    const changed = await tx.eventInvitation.updateMany({
      where: { id: invitation.id, recipientUserId: userId, status: "PENDING", expiresAt: { gt: new Date() } },
      data: decision === "ACCEPTED" ? { status: "ACCEPTED", acceptedAt: new Date() } : { status: "DECLINED", declinedAt: new Date() }
    });
    if (changed.count !== 1) fail("INVITATION_INVALID", "Invitation is invalid or unavailable", 404);
    if (decision === "ACCEPTED") await createGrant(tx, { eventId: event.id, organizationId: event.organizationId, userId, source: "INVITATION", sourceId: invitation.id, expiresAt: grantExpiry });
    await tx.auditLog.create({ data: { actorId: userId, actorType: "user", action: `event.access.invitation.${decision.toLowerCase()}`, resourceType: "event_invitation", resourceId: invitation.id } });
    return { id: invitation.id, status: decision };
  });
}

export async function revokeGrant(input: { grantId: string; eventId: string; organizationId: string; actorId: string; reason: string }) {
  return prisma.$transaction(async (tx) => {
    await assertManager(tx, input.organizationId, input.eventId, input.actorId);
    const changed = await tx.eventAccessGrant.updateMany({
      where: { id: input.grantId, eventId: input.eventId, organizationId: input.organizationId, status: "ACTIVE" },
      data: { status: "REVOKED", revokedAt: new Date(), revokedByUserId: input.actorId, revokeReason: input.reason }
    });
    if (changed.count !== 1) fail("ACCESS_GRANT_NOT_REVOCABLE", "Active access grant was not found", 404);
    await tx.auditLog.create({ data: { actorId: input.actorId, actorType: "user", action: "event.access.grant.revoked", resourceType: "event_access_grant", resourceId: input.grantId, metadata: { reason: input.reason } } });
    await tx.outboxMessage.create({
      data: { aggregateType: "event_access_grant", aggregateId: input.grantId, eventType: "EventAccessRevoked", deduplicationKey: `event.access.revoked:${input.grantId}`, payload: { eventId: input.eventId, grantId: input.grantId } }
    });
    return { id: input.grantId, status: "REVOKED" as const };
  });
}

export async function setPlatformHold(input: { eventId: string; actorId: string; reason: string; release: boolean }) {
  return prisma.$transaction(async (tx) => {
    const event = await tx.event.findUnique({ where: { id: input.eventId }, select: { id: true } });
    if (!event) fail("EVENT_NOT_FOUND", "Event was not found", 404);
    if (input.release) {
      const hold = await tx.eventAccessHold.findUnique({ where: { eventId: input.eventId } });
      if (!hold || hold.releasedAt) fail("ACCESS_HOLD_NOT_ACTIVE", "No active access hold exists", 404);
      await tx.eventAccessHold.update({ where: { eventId: input.eventId }, data: { releasedAt: new Date(), releasedByUserId: input.actorId } });
    } else {
      await tx.eventAccessHold.create({ data: { eventId: input.eventId, reason: input.reason, createdByUserId: input.actorId } });
    }
    await tx.auditLog.create({ data: { actorId: input.actorId, actorType: "user", action: input.release ? "event.access.hold.released" : "event.access.hold.placed", resourceType: "event", resourceId: input.eventId, metadata: { reason: input.reason } } });
    return { eventId: input.eventId, holdActive: !input.release };
  });
}

export async function expireAccessRecords() {
  const now = new Date();
  const [invitations, grants] = await prisma.$transaction([
    prisma.eventInvitation.updateMany({ where: { status: "PENDING", expiresAt: { lte: now } }, data: { status: "EXPIRED" } }),
    prisma.eventAccessGrant.updateMany({ where: { status: "ACTIVE", expiresAt: { lte: now } }, data: { status: "EXPIRED" } })
  ]);
  return { invitationsExpired: invitations.count, grantsExpired: grants.count };
}
