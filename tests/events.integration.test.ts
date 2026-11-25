import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  getPrismaClient,
  connectDatabase,
  disconnectDatabase
} from "../src/infrastructure/database/prisma.js";
import {
  createDraft,
  getManagedEvent,
  getPublicEvent,
  listPublicEvents,
  publishDraft
} from "../src/modules/events/events.db.js";
import { submitRequest, listRequests, decideRequest, issueInvitation, respondToInvitation, myAccess, setPlatformHold } from "../src/modules/event-access/event-access.db.js";

const enabled = Boolean(process.env.DATABASE_URL);
const prisma = getPrismaClient();

describe.skipIf(!enabled)("Event marketplace PostgreSQL integration", () => {
  let ownerId: string;
  let memberId: string;
  let organizationId: string;
  let categoryId: string;

  beforeAll(async () => {
    await connectDatabase();
  });

  beforeEach(async () => {
    await prisma.eventAccessHold.deleteMany();
    await prisma.eventAccessGrant.deleteMany();
    await prisma.eventAccessRequest.deleteMany();
    await prisma.eventInvitation.deleteMany();
    await prisma.eventRevision.deleteMany();
    await prisma.eventVenue.deleteMany();
    await prisma.eventSchedule.deleteMany();
    await prisma.event.deleteMany();
    await prisma.organizerApplication.deleteMany();
    await prisma.organizationMembership.deleteMany();
    await prisma.organization.deleteMany();
    await prisma.session.deleteMany();
    await prisma.passwordCredential.deleteMany();
    await prisma.userProfile.deleteMany();
    await prisma.user.deleteMany();

    const owner = await prisma.user.create({
      data: { email: `owner-${crypto.randomUUID()}@events.test` }
    });
    const member = await prisma.user.create({
      data: { email: `member-${crypto.randomUUID()}@events.test` }
    });
    ownerId = owner.id;
    memberId = member.id;
    const organization = await prisma.organization.create({
      data: {
        name: "Integration Test Organizer",
        slug: `integration-${crypto.randomUUID()}`,
        createdById: ownerId,
        memberships: {
          create: [
            { userId: ownerId, role: "OWNER", status: "ACTIVE" },
            { userId: memberId, role: "MEMBER", status: "ACTIVE" }
          ]
        }
      }
    });
    organizationId = organization.id;
    const category = await prisma.eventCategory.findUniqueOrThrow({
      where: { slug: "music" },
      select: { id: true }
    });
    categoryId = category.id;
  });

  afterAll(async () => {
    await disconnectDatabase();
  });

  async function createDraftEvent(slug = "integration-event", accessPolicy: "OPEN" | "APPROVAL_REQUIRED" | "INVITATION_ONLY" = "OPEN", visibility: "PUBLIC" | "UNLISTED" | "INVITATION_ONLY" = "PUBLIC") {
    return createDraft({
      organizationId,
      actorUserId: ownerId,
      categoryId,
      title: "Integration Test Live Show",
      slug,
      summary: "A live music event used to verify marketplace persistence.",
      description:
        "This event exists only to exercise PostgreSQL-backed event workflows.",
      format: "IN_PERSON",
      visibility,
      accessPolicy,
      timezone: "Africa/Lagos",
      schedules: [
        {
          startsAt: "2027-04-10T09:00:00+01:00",
          endsAt: "2027-04-10T17:00:00+01:00",
          label: "Main programme"
        }
      ],
      venue: {
        displayName: "Test Arena",
        city: "Osogbo",
        state: "Osun",
        country: "Nigeria",
        exactAddress: "12 Private Test Lane",
        accessInstructions: "Use the rear entrance",
        privateUrl: "https://private.example.test/entry"
      }
    });
  }

  it("persists drafts, revisions and private venue data while keeping public serialization restricted", async () => {
    const draft = await createDraftEvent();
    expect(draft.status).toBe("DRAFT");
    expect(draft.schedules).toHaveLength(1);

    const managed = await getManagedEvent(draft.id, ownerId);
    expect(managed.venue?.exactAddress).toBe("12 Private Test Lane");
    expect(managed.venue?.accessInstructions).toBe("Use the rear entrance");
    expect(managed.venue?.privateUrl).toBe(
      "https://private.example.test/entry"
    );

    await prisma.organizerApplication.create({
      data: {
        organizationId,
        applicantUserId: ownerId,
        status: "APPROVED",
        applicationMessage: "Approved integration fixture",
        decisionReason: "Integration fixture approval",
        reviewedAt: new Date(),
        reviewedByUserId: ownerId
      }
    });
    await publishDraft(draft.id, ownerId);
    const publicEvent = await getPublicEvent(draft.id);
    const serialized = JSON.stringify(publicEvent);
    expect(serialized).not.toContain("12 Private Test Lane");
    expect(serialized).not.toContain("Use the rear entrance");
    expect(serialized).not.toContain("private.example.test");
    expect(publicEvent.venue).toEqual({
      displayName: "Test Arena",
      city: "Osogbo",
      state: "Osun",
      country: "Nigeria"
    });
  });

  it("blocks publishing until the organization has an approved organizer application", async () => {
    const draft = await createDraftEvent();
    await expect(publishDraft(draft.id, ownerId)).rejects.toMatchObject({
      code: "ORGANIZER_APPROVAL_REQUIRED",
      statusCode: 403
    });
    expect(
      await prisma.event.findUniqueOrThrow({ where: { id: draft.id } })
    ).toMatchObject({ status: "DRAFT", publishedAt: null });
  });

  it("rejects event management by an ordinary organization member", async () => {
    await expect(
      createDraft({
        organizationId,
        actorUserId: memberId,
        categoryId,
        title: "Unauthorized Event",
        slug: "unauthorized-event",
        summary: "A member must not be able to create an event.",
        description:
          "This event creation attempt must be denied by the database service.",
        format: "ONLINE",
        visibility: "PUBLIC",
        accessPolicy: "OPEN",
        timezone: "Africa/Lagos",
        schedules: [
          {
            startsAt: "2027-04-10T09:00:00Z",
            endsAt: "2027-04-10T10:00:00Z"
          }
        ]
      })
    ).rejects.toMatchObject({ code: "EVENT_FORBIDDEN", statusCode: 403 });
  });

  it("excludes drafts and unlisted events from public discovery", async () => {
    const draft = await createDraftEvent("draft-hidden");
    const unlisted = await createDraft({
      organizationId,
      actorUserId: ownerId,
      categoryId,
      title: "Unlisted Test Event",
      slug: "unlisted-hidden",
      summary: "This event must not appear in public discovery.",
      description:
        "Unlisted events are intentionally excluded from public discovery results.",
      format: "ONLINE",
      visibility: "UNLISTED",
      accessPolicy: "OPEN",
      timezone: "Africa/Lagos",
      schedules: [
        {
          startsAt: "2027-04-11T09:00:00Z",
          endsAt: "2027-04-11T10:00:00Z"
        }
      ]
    });
    const result = await listPublicEvents({ limit: 50 });
    const ids = result.items.map((item) => item.id);
    expect(ids).not.toContain(draft.id);
    expect(ids).not.toContain(unlisted.id);
    await expect(getPublicEvent(draft.id)).rejects.toMatchObject({
      code: "EVENT_NOT_FOUND",
      statusCode: 404
    });
  });

  it("writes an audit record and outbox message atomically when publishing", async () => {
    const draft = await createDraftEvent("publish-outbox-event");
    await prisma.organizerApplication.create({
      data: {
        organizationId,
        applicantUserId: ownerId,
        status: "APPROVED",
        applicationMessage: "Approved integration fixture",
        decisionReason: "Integration fixture approval",
        reviewedAt: new Date(),
        reviewedByUserId: ownerId
      }
    });
    await publishDraft(draft.id, ownerId);
    expect(
      await prisma.auditLog.findFirst({
        where: { action: "event.published", resourceId: draft.id }
      })
    ).not.toBeNull();
    expect(
      await prisma.outboxMessage.findUnique({
        where: { deduplicationKey: `event.published:${draft.id}` }
      })
    ).not.toBeNull();
  });
});


  it("creates an event-scoped grant only after organizer approval of an access request", async () => {
    const draft = await createDraftEvent("approval-required-event", "APPROVAL_REQUIRED");
    await prisma.organizerApplication.create({
      data: {
        organizationId, applicantUserId: ownerId, status: "APPROVED",
        applicationMessage: "Approved integration fixture",
        decisionReason: "Integration fixture approval",
        reviewedAt: new Date(), reviewedByUserId: ownerId
      }
    });
    await publishDraft(draft.id, ownerId);
    const request = await submitRequest(draft.id, memberId, "I would like to attend.");
    expect(request.status).toBe("SUBMITTED");
    const queue = await listRequests(draft.id, organizationId, ownerId);
    expect(queue).toHaveLength(1);
    await decideRequest({
      requestId: request.id, eventId: draft.id, organizationId,
      actorId: ownerId, decision: "APPROVED", reason: "Request approved"
    });
    const access = await myAccess(draft.id, memberId);
    expect(access.canViewDetails).toBe(true);
    expect(access.canCheckout).toBe(true);
    expect(access.grant?.source).toBe("ACCESS_REQUEST");
    expect(await prisma.eventAccessGrant.count({ where: { eventId: draft.id, userId: memberId, status: "ACTIVE" } })).toBe(1);
    expect(await prisma.outboxMessage.count({ where: { eventType: "EventAccessGranted", aggregateId: access.grant!.id } })).toBe(1);
  });

  it("binds invitations to verified recipient accounts and prevents reuse", async () => {
    const recipient = await prisma.user.create({
      data: { email: `verified-${crypto.randomUUID()}@events.test`, emailVerifiedAt: new Date() }
    });
    const draft = await createDraftEvent("invitation-only-event", "INVITATION_ONLY", "INVITATION_ONLY");
    await prisma.organizerApplication.create({
      data: {
        organizationId, applicantUserId: ownerId, status: "APPROVED",
        applicationMessage: "Approved integration fixture",
        decisionReason: "Integration fixture approval",
        reviewedAt: new Date(), reviewedByUserId: ownerId
      }
    });
    await publishDraft(draft.id, ownerId);
    const issued = await issueInvitation({
      eventId: draft.id, organizationId, actorId: ownerId,
      recipientEmail: recipient.email
    });
    expect(issued.token).toBeTruthy();
    await expect(respondToInvitation(issued.token, memberId, "ACCEPTED")).rejects.toMatchObject({ code: "INVITATION_INVALID", statusCode: 404 });
    await respondToInvitation(issued.token, recipient.id, "ACCEPTED");
    await expect(respondToInvitation(issued.token, recipient.id, "ACCEPTED")).rejects.toMatchObject({ code: "INVITATION_INVALID", statusCode: 404 });
    const access = await myAccess(draft.id, recipient.id);
    expect(access.canViewDetails).toBe(true);
    expect(access.canCheckout).toBe(true);
    expect(access.grant?.source).toBe("INVITATION");
  });

  it("blocks access checks while a platform access hold is active", async () => {
    const draft = await createDraftEvent("held-event");
    await prisma.organizerApplication.create({
      data: {
        organizationId, applicantUserId: ownerId, status: "APPROVED",
        applicationMessage: "Approved integration fixture",
        decisionReason: "Integration fixture approval",
        reviewedAt: new Date(), reviewedByUserId: ownerId
      }
    });
    await publishDraft(draft.id, ownerId);
    await setPlatformHold({ eventId: draft.id, actorId: ownerId, reason: "Safety review", release: false });
    await expect(myAccess(draft.id, memberId)).rejects.toMatchObject({ code: "EVENT_ACCESS_ON_HOLD", statusCode: 403 });
  });


  it("requires both an invitation and organizer approval for invitation-only approval-required events", async () => {
    const recipient = await prisma.user.create({
      data: { email: `dual-gate-${crypto.randomUUID()}@events.test`, emailVerifiedAt: new Date() }
    });
    const draft = await createDraftEvent("dual-gate-event", "APPROVAL_REQUIRED", "INVITATION_ONLY");
    await prisma.organizerApplication.create({
      data: {
        organizationId, applicantUserId: ownerId, status: "APPROVED",
        applicationMessage: "Approved integration fixture",
        decisionReason: "Integration fixture approval",
        reviewedAt: new Date(), reviewedByUserId: ownerId
      }
    });
    await publishDraft(draft.id, ownerId);
    await expect(submitRequest(draft.id, recipient.id)).rejects.toMatchObject({ code: "INVITATION_REQUIRED", statusCode: 403 });
    const issued = await issueInvitation({ eventId: draft.id, organizationId, actorId: ownerId, recipientEmail: recipient.email });
    await respondToInvitation(issued.token, recipient.id, "ACCEPTED");
    expect(await myAccess(draft.id, recipient.id)).toMatchObject({ canViewDetails: true, canCheckout: false });
    const request = await submitRequest(draft.id, recipient.id, "Please approve checkout access.");
    await decideRequest({ requestId: request.id, eventId: draft.id, organizationId, actorId: ownerId, decision: "APPROVED", reason: "Approved after invitation" });
    expect(await myAccess(draft.id, recipient.id)).toMatchObject({ canViewDetails: true, canCheckout: true });
  });
