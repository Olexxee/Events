import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  connectDatabase,
  disconnectDatabase,
  getPrismaClient
} from "../src/infrastructure/database/prisma.js";
import {
  addProviderApplicationEvidence,
  changeProviderApprovalStatus,
  reviewProviderApplication,
  submitProviderApplication
} from "../src/modules/vybe-provider/vybe-provider.db.js";

const enabled = Boolean(process.env.DATABASE_URL);
const prisma = getPrismaClient();

describe.skipIf(!enabled)("Vybe provider PostgreSQL integration", () => {
  beforeAll(async () => {
    await connectDatabase();
  });

  afterAll(async () => {
    await disconnectDatabase();
  });

  async function createApplicant(emailVerified = true) {
    const user = await prisma.user.create({
      data: {
        email: `vybe-applicant-${crypto.randomUUID()}@events.test`,
        ...(emailVerified ? { emailVerifiedAt: new Date() } : {})
      }
    });

    const organization = await prisma.organization.create({
      data: {
        name: "Vybe Provider Test",
        slug: `vybe-provider-${crypto.randomUUID()}`,
        createdById: user.id,
        memberships: {
          create: {
            userId: user.id,
            role: "OWNER",
            status: "ACTIVE"
          }
        }
      }
    });

    return { user, organization };
  }

  async function submit(
    userId: string,
    organizationId: string,
    withEvidence = false
  ) {
    return submitProviderApplication({
      organizationId,
      applicantUserId: userId,
      category: "ACCOMMODATION",
      serviceDescription: "We operate serviced apartments for short stays.",
      supplyAuthorityStatement:
        "Our organization owns and directly operates these apartments.",
      supplyAuthorityAttested: true,
      termsAccepted: true,
      locations: [
        { city: "Ile-Ife", state: "Osun", country: "Nigeria" }
      ],
      ...(withEvidence
        ? {
            evidence: [
              {
                evidenceType: "operating-permit",
                requirementReason:
                  "Requested for this accommodation service based on its operating risk.",
                storageReference: "private://vybe/evidence/operating-permit"
              }
            ]
          }
        : {})
    });
  }

  it("requires an active account with a verified contact channel", async () => {
    const { user, organization } = await createApplicant(false);

    await expect(submit(user.id, organization.id)).rejects.toMatchObject({
      code: "VYBE_PROVIDER_VERIFIED_ACCOUNT_REQUIRED"
    });
  });

  it("creates a provider application linked to the existing organization", async () => {
    const { user, organization } = await createApplicant();
    const application = await submit(user.id, organization.id, true);

    expect(application.organizationId).toBe(organization.id);
    expect(application.applicantUserId).toBe(user.id);
    expect(application.status).toBe("SUBMITTED");
    expect(application.locations).toHaveLength(1);
    expect(application.evidence).toHaveLength(1);
    expect(
      await prisma.vybeProviderProfile.count({
        where: { organizationId: organization.id }
      })
    ).toBe(0);
  });

  it("prevents applicants from reviewing their own applications", async () => {
    const { user, organization } = await createApplicant();
    const application = await submit(user.id, organization.id);

    await expect(
      reviewProviderApplication({
        applicationId: application.id,
        reviewerUserId: user.id,
        decision: "APPROVED",
        reason: "Attempted self approval is not permitted."
      })
    ).rejects.toMatchObject({
      code: "VYBE_PROVIDER_SELF_REVIEW_FORBIDDEN"
    });
  });

  it("prevents organization-affiliated platform reviewers from reviewing", async () => {
    const { user, organization } = await createApplicant();
    const reviewer = await prisma.user.create({
      data: { email: `vybe-conflicted-reviewer-${crypto.randomUUID()}@events.test` }
    });
    await prisma.organizationMembership.create({
      data: {
        organizationId: organization.id,
        userId: reviewer.id,
        role: "ADMIN",
        status: "ACTIVE"
      }
    });
    const application = await submit(user.id, organization.id);

    await expect(
      reviewProviderApplication({
        applicationId: application.id,
        reviewerUserId: reviewer.id,
        decision: "APPROVED",
        reason: "An affiliated reviewer must not approve this application."
      })
    ).rejects.toMatchObject({
      code: "VYBE_PROVIDER_CONFLICTED_REVIEWER"
    });
  });

  it("approves only after submitted evidence has been accepted and creates a scoped approval", async () => {
    const { user, organization } = await createApplicant();
    const reviewer = await prisma.user.create({
      data: { email: `vybe-reviewer-${crypto.randomUUID()}@events.test` }
    });
    const application = await submit(user.id, organization.id, true);
    const evidence = application.evidence[0];

    if (!evidence) {
      throw new Error("Expected the application to include evidence");
    }

    const approved = await reviewProviderApplication({
      applicationId: application.id,
      reviewerUserId: reviewer.id,
      decision: "APPROVED",
      reason: "The required evidence and supply authority have been verified.",
      conditions: ["Approval is limited to the submitted location."],
      evidenceDecisions: [
        {
          evidenceId: evidence.id,
          status: "ACCEPTED",
          reason: "The evidence is current and satisfies the recorded requirement."
        }
      ]
    });

    expect(approved.status).toBe("APPROVED");

    const profile = await prisma.vybeProviderProfile.findUniqueOrThrow({
      where: { organizationId: organization.id },
      include: { approvals: true }
    });

    expect(profile.approvals).toHaveLength(1);
    expect(profile.approvals[0]).toMatchObject({
      category: "ACCOMMODATION",
      status: "ACTIVE",
      approvedByUserId: reviewer.id,
      conditions: ["Approval is limited to the submitted location."]
    });
  });

  it("allows requested evidence to be resubmitted without deleting its review history", async () => {
    const { user, organization } = await createApplicant();
    const reviewer = await prisma.user.create({
      data: { email: `vybe-reviewer-${crypto.randomUUID()}@events.test` }
    });
    const application = await submit(user.id, organization.id, true);
    const oldEvidence = application.evidence[0];

    if (!oldEvidence) {
      throw new Error("Expected the application to include evidence");
    }

    await reviewProviderApplication({
      applicationId: application.id,
      reviewerUserId: reviewer.id,
      decision: "NEEDS_INFORMATION",
      reason: "Please provide a current version of the operating permit."
    });

    const replacement = await addProviderApplicationEvidence({
      applicationId: application.id,
      applicantUserId: user.id,
      evidence: [
        {
          evidenceType: "operating-permit",
          requirementReason: "Replacement evidence requested by the review team.",
          storageReference: "private://vybe/evidence/operating-permit-v2"
        }
      ]
    });

    expect(replacement).toHaveLength(1);
    expect(replacement[0]?.status).toBe("PENDING");
    expect(
      await prisma.vybeProviderEvidence.findUniqueOrThrow({
        where: { id: oldEvidence.id },
        select: { status: true }
      })
    ).toEqual({ status: "SUPERSEDED" });
    expect(
      await prisma.vybeProviderApplication.findUniqueOrThrow({
        where: { id: application.id },
        select: { status: true }
      })
    ).toEqual({ status: "SUBMITTED" });
  });

  it("retains suspension and revocation history and blocks reapplication", async () => {
    const { user, organization } = await createApplicant();
    const reviewer = await prisma.user.create({
      data: { email: `vybe-reviewer-${crypto.randomUUID()}@events.test` }
    });
    const application = await submit(user.id, organization.id);

    await reviewProviderApplication({
      applicationId: application.id,
      reviewerUserId: reviewer.id,
      decision: "APPROVED",
      reason: "The provider meets the baseline approval requirements."
    });

    const approval = await prisma.vybeProviderApproval.findFirstOrThrow({
      where: { applicationId: application.id }
    });

    const suspended = await changeProviderApprovalStatus({
      approvalId: approval.id,
      reviewerUserId: reviewer.id,
      action: "SUSPENDED",
      reason: "A material safety concern requires immediate restriction."
    });

    expect(suspended.status).toBe("SUSPENDED");
    await expect(submit(user.id, organization.id)).rejects.toMatchObject({
      code: "VYBE_PROVIDER_CATEGORY_RESTRICTED"
    });

    const revoked = await changeProviderApprovalStatus({
      approvalId: approval.id,
      reviewerUserId: reviewer.id,
      action: "REVOKED",
      reason: "The provider failed to resolve the documented safety concern."
    });

    expect(revoked.status).toBe("REVOKED");
    expect(
      await prisma.vybeProviderReview.findMany({
        where: { applicationId: application.id },
        select: { action: true },
        orderBy: { createdAt: "asc" }
      })
    ).toMatchObject([
      { action: "APPROVED" },
      { action: "SUSPENDED" },
      { action: "REVOKED" }
    ]);
  });
});
