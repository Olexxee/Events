import type { Prisma, VybeCategory, VybeProviderApplicationStatus } from "@prisma/client";
import { getPrismaClient } from "../../infrastructure/database/prisma.js";
import { AppError } from "../../shared/errors/app-error.js";

const OPEN_APPLICATION_STATUSES: VybeProviderApplicationStatus[] = [
  "SUBMITTED",
  "UNDER_REVIEW",
  "NEEDS_INFORMATION"
];

export async function submitProviderApplication(input: {
  organizationId: string;
  applicantUserId: string;
  category: VybeCategory;
  serviceDescription: string;
  supplyAuthorityStatement: string;
  supplyAuthorityAttested: true;
  termsVersion: string;
  locations: { city: string; state: string; country: string }[];
  evidence?: {
    evidenceType: string;
    requirementReason: string;
    storageReference: string;
  }[];
}) {
  const prisma = getPrismaClient();

  try {
    return await prisma.$transaction(async (tx) => {
      const [user, membership] = await Promise.all([
        tx.user.findUnique({
          where: { id: input.applicantUserId },
          select: { status: true, emailVerifiedAt: true }
        }),
        tx.organizationMembership.findUnique({
          where: {
            organizationId_userId: {
              organizationId: input.organizationId,
              userId: input.applicantUserId
            }
          },
          select: {
            role: true,
            status: true,
            organization: { select: { id: true, name: true, status: true } }
          }
        })
      ]);

      if (!user || user.status !== "ACTIVE" || !user.emailVerifiedAt) {
        throw new AppError(
          "VYBE_PROVIDER_VERIFIED_ACCOUNT_REQUIRED",
          "A verified, active account is required to apply as a Vybe provider",
          403
        );
      }

      if (
        !membership ||
        membership.status !== "ACTIVE" ||
        !["OWNER", "ADMIN"].includes(membership.role) ||
        membership.organization.status !== "ACTIVE"
      ) {
        throw new AppError(
          "VYBE_PROVIDER_ORGANIZATION_FORBIDDEN",
          "An active organization owner or admin must submit the application",
          403
        );
      }

      const providerProfile = await tx.vybeProviderProfile.findUnique({
        where: { organizationId: input.organizationId },
        select: { id: true }
      });
      if (providerProfile) {
        await tx.vybeProviderApproval.updateMany({
          where: {
            providerProfileId: providerProfile.id,
            category: input.category,
            status: "ACTIVE",
            expiresAt: { lte: new Date() }
          },
          data: { status: "EXPIRED" }
        });
      }
      const existingApproval = await tx.vybeProviderApproval.findFirst({
        where: {
          providerProfile: { organizationId: input.organizationId },
          category: input.category,
          status: "ACTIVE"
        },
        select: { id: true }
      });
      if (existingApproval) {
        throw new AppError(
          "VYBE_PROVIDER_CATEGORY_ALREADY_APPROVED",
          "This organization is already approved for the selected Vybe category",
          409
        );
      }

      const existingApplication = await tx.vybeProviderApplication.findFirst({
        where: {
          organizationId: input.organizationId,
          category: input.category,
          status: { in: OPEN_APPLICATION_STATUSES }
        },
        select: { id: true }
      });
      if (existingApplication) {
        throw new AppError(
          "VYBE_PROVIDER_APPLICATION_ALREADY_OPEN",
          "An application for this category is already being processed",
          409
        );
      }

      const application = await tx.vybeProviderApplication.create({
        data: {
          organizationId: input.organizationId,
          applicantUserId: input.applicantUserId,
          category: input.category,
          serviceDescription: input.serviceDescription,
          supplyAuthorityStatement: input.supplyAuthorityStatement,
          supplyAuthorityAttested: input.supplyAuthorityAttested,
          termsVersion: input.termsVersion,
          termsAcceptedAt: new Date(),
          locations: { create: input.locations },
          ...(input.evidence?.length
            ? { evidence: { create: input.evidence } }
            : {})
        },
        include: {
          locations: true,
          evidence: {
            select: {
              id: true,
              evidenceType: true,
              requirementReason: true,
              status: true,
              createdAt: true
            }
          }
        }
      });

      await tx.auditLog.create({
        data: {
          actorId: input.applicantUserId,
          actorType: "user",
          action: "vybe.provider_application.submitted",
          resourceType: "vybe_provider_application",
          resourceId: application.id,
          metadata: {
            organizationId: input.organizationId,
            category: input.category,
            locationCount: input.locations.length,
            evidenceCount: input.evidence?.length ?? 0
          }
        }
      });

      return application;
    });
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "P2002"
    ) {
      throw new AppError(
        "VYBE_PROVIDER_APPLICATION_ALREADY_OPEN",
        "An application for this category is already being processed",
        409
      );
    }
    throw error;
  }
}

export async function listMyProviderApplications(userId: string) {
  return getPrismaClient().vybeProviderApplication.findMany({
    where: { applicantUserId: userId },
    include: {
      locations: true,
      evidence: {
        select: {
          id: true,
          evidenceType: true,
          requirementReason: true,
          status: true,
          reviewReason: true,
          createdAt: true
        }
      },
      reviews: {
        select: { action: true, reason: true, createdAt: true },
        orderBy: { createdAt: "asc" }
      },
      organization: { select: { id: true, name: true, slug: true } }
    },
    orderBy: { submittedAt: "desc" }
  });
}

export async function listProviderApplications() {
  return getPrismaClient().vybeProviderApplication.findMany({
    where: { status: { in: OPEN_APPLICATION_STATUSES } },
    include: {
      locations: true,
      evidence: {
        select: {
          id: true,
          evidenceType: true,
          requirementReason: true,
          storageReference: true,
          status: true,
          reviewReason: true,
          createdAt: true
        }
      },
      reviews: {
        select: { reviewerUserId: true, action: true, reason: true, createdAt: true },
        orderBy: { createdAt: "asc" }
      },
      organization: { select: { id: true, name: true, slug: true, status: true } },
      applicant: {
        select: {
          id: true,
          email: true,
          profile: { select: { displayName: true } }
        }
      }
    },
    orderBy: { submittedAt: "asc" },
    take: 100
  });
}

export async function reviewProviderApplication(input: {
  applicationId: string;
  reviewerUserId: string;
  decision: "UNDER_REVIEW" | "NEEDS_INFORMATION" | "APPROVED" | "REJECTED";
  reason: string;
  conditions?: string[];
  expiresAt?: string;
  evidenceDecisions?: {
    evidenceId: string;
    status: "ACCEPTED" | "REJECTED";
    reason: string;
  }[];
}) {
  const prisma = getPrismaClient();

  return prisma.$transaction(async (tx) => {
    const application = await tx.vybeProviderApplication.findUnique({
      where: { id: input.applicationId },
      include: { locations: true, evidence: true }
    });

    if (!application) {
      throw new AppError(
        "VYBE_PROVIDER_APPLICATION_NOT_FOUND",
        "Vybe provider application was not found",
        404
      );
    }
    if (application.applicantUserId === input.reviewerUserId) {
      throw new AppError(
        "VYBE_PROVIDER_SELF_REVIEW_FORBIDDEN",
        "Applicants cannot review or approve their own provider application",
        403
      );
    }
    if (!OPEN_APPLICATION_STATUSES.includes(application.status)) {
      throw new AppError(
        "VYBE_PROVIDER_APPLICATION_NOT_REVIEWABLE",
        "This provider application is already final",
        409
      );
    }

    for (const evidenceDecision of input.evidenceDecisions ?? []) {
      const changed = await tx.vybeProviderEvidence.updateMany({
        where: {
          id: evidenceDecision.evidenceId,
          applicationId: application.id
        },
        data: {
          status: evidenceDecision.status,
          reviewedByUserId: input.reviewerUserId,
          reviewedAt: new Date(),
          reviewReason: evidenceDecision.reason
        }
      });
      if (changed.count !== 1) {
        throw new AppError(
          "VYBE_PROVIDER_EVIDENCE_NOT_FOUND",
          "One or more evidence records do not belong to this application",
          404
        );
      }
    }

    if (input.decision === "APPROVED") {
      if (input.expiresAt && new Date(input.expiresAt).getTime() <= Date.now()) {
        throw new AppError(
          "VYBE_PROVIDER_APPROVAL_EXPIRY_INVALID",
          "Approval expiry must be in the future",
          400
        );
      }
      const evidence = await tx.vybeProviderEvidence.findMany({
        where: { applicationId: application.id, status: { not: "SUPERSEDED" } },
        select: { status: true }
      });
      if (evidence.some((item) => item.status !== "ACCEPTED")) {
        throw new AppError(
          "VYBE_PROVIDER_EVIDENCE_REVIEW_REQUIRED",
          "All submitted evidence must be accepted before approval",
          409
        );
      }
      const profile = await tx.vybeProviderProfile.upsert({
        where: { organizationId: application.organizationId },
        create: { organizationId: application.organizationId },
        update: {}
      });
      await tx.vybeProviderApproval.updateMany({
        where: {
          providerProfileId: profile.id,
          category: application.category,
          status: "ACTIVE",
          expiresAt: { lte: new Date() }
        },
        data: { status: "EXPIRED" }
      });
      const activeApproval = await tx.vybeProviderApproval.findFirst({
        where: {
          providerProfileId: profile.id,
          category: application.category,
          status: "ACTIVE"
        },
        select: { id: true }
      });
      if (activeApproval) {
        throw new AppError(
          "VYBE_PROVIDER_CATEGORY_ALREADY_APPROVED",
          "This organization already has an active approval for this category",
          409
        );
      }
      const locations = application.locations.map(({ city, state, country }) => ({
        city,
        state,
        country
      }));
      await tx.vybeProviderApproval.create({
        data: {
          providerProfileId: profile.id,
          category: application.category,
          locations: locations as Prisma.InputJsonValue,
          conditions: (input.conditions ?? []) as Prisma.InputJsonValue,
          approvedByUserId: input.reviewerUserId,
          ...(input.expiresAt ? { expiresAt: new Date(input.expiresAt) } : {})
        }
      });
    }

    const status: VybeProviderApplicationStatus = input.decision;
    const updated = await tx.vybeProviderApplication.update({
      where: { id: application.id },
      data: {
        status,
        reviewedAt: new Date(),
        decisionReason: input.reason
      },
      select: {
        id: true,
        organizationId: true,
        category: true,
        status: true,
        reviewedAt: true,
        decisionReason: true
      }
    });

    const action = input.decision === "UNDER_REVIEW"
      ? "REVIEW_STARTED"
      : input.decision === "NEEDS_INFORMATION"
        ? "INFORMATION_REQUESTED"
        : input.decision;

    await tx.vybeProviderReview.create({
      data: {
        applicationId: application.id,
        reviewerUserId: input.reviewerUserId,
        action,
        reason: input.reason
      }
    });
    await tx.auditLog.create({
      data: {
        actorId: input.reviewerUserId,
        actorType: "user",
        action: `vybe.provider_application.${input.decision.toLowerCase()}`,
        resourceType: "vybe_provider_application",
        resourceId: application.id,
        metadata: {
          organizationId: application.organizationId,
          category: application.category,
          reason: input.reason
        }
      }
    });
    return updated;
  });
}

export async function addProviderApplicationEvidence(input: {
  applicationId: string;
  applicantUserId: string;
  evidence: {
    evidenceType: string;
    requirementReason: string;
    storageReference: string;
  }[];
}) {
  const prisma = getPrismaClient();
  return prisma.$transaction(async (tx) => {
    const application = await tx.vybeProviderApplication.findUnique({
      where: { id: input.applicationId },
      select: {
        id: true,
        organizationId: true,
        applicantUserId: true,
        status: true
      }
    });
    if (!application) {
      throw new AppError("VYBE_PROVIDER_APPLICATION_NOT_FOUND", "Vybe provider application was not found", 404);
    }
    if (application.applicantUserId !== input.applicantUserId) {
      throw new AppError("VYBE_PROVIDER_APPLICATION_FORBIDDEN", "Only the applicant may add evidence", 403);
    }
    if (application.status !== "NEEDS_INFORMATION") {
      throw new AppError("VYBE_PROVIDER_EVIDENCE_NOT_REQUESTED", "Additional evidence can only be submitted after the review team requests information", 409);
    }
    const membership = await tx.organizationMembership.findUnique({
      where: {
        organizationId_userId: {
          organizationId: application.organizationId,
          userId: input.applicantUserId
        }
      },
      select: { status: true, role: true, organization: { select: { status: true } } }
    });
    if (!membership || membership.status !== "ACTIVE" || !["OWNER", "ADMIN"].includes(membership.role) || membership.organization.status !== "ACTIVE") {
      throw new AppError("VYBE_PROVIDER_ORGANIZATION_FORBIDDEN", "An active organization owner or admin must submit evidence", 403);
    }

    for (const item of input.evidence) {
      await tx.vybeProviderEvidence.updateMany({
        where: {
          applicationId: application.id,
          evidenceType: item.evidenceType,
          status: { in: ["PENDING", "ACCEPTED", "REJECTED"] }
        },
        data: { status: "SUPERSEDED" }
      });
    }

    const created = await tx.vybeProviderEvidence.createMany({
      data: input.evidence.map((item) => ({
        applicationId: application.id,
        ...item
      }))
    });
    await tx.vybeProviderApplication.update({
      where: { id: application.id },
      data: { status: "SUBMITTED" }
    });
    await tx.auditLog.create({
      data: {
        actorId: input.applicantUserId,
        actorType: "user",
        action: "vybe.provider_application.evidence_submitted",
        resourceType: "vybe_provider_application",
        resourceId: application.id,
        metadata: { evidenceCount: created.count }
      }
    });
    return tx.vybeProviderEvidence.findMany({
      where: { applicationId: application.id, status: "PENDING" },
      select: { id: true, evidenceType: true, requirementReason: true, status: true, createdAt: true },
      orderBy: { createdAt: "desc" }
    });
  });
}
