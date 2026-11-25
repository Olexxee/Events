import { randomUUID } from "node:crypto";
import type {
  Prisma,
  VybeCategory,
  VybeProviderApplicationStatus
} from "@prisma/client";
import { getPrismaClient } from "../../infrastructure/database/prisma.js";
import { assertActiveVerifiedAccount } from "../identity/identity.contracts.js";
import {
  assertIndependentOrganizationReviewer,
  assertOrganizationAuthority
} from "../organizations/organizations.contracts.js";
import { AppError } from "../../shared/errors/app-error.js";
import { enqueueOutboxMessage } from "../../shared/outbox/outbox.repository.js";

const CURRENT_PROVIDER_TERMS_VERSION = "vybe-provider-v1";

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
  termsAccepted: true;
  locations: { city: string; state: string; country: string }[];
  evidence?: {
    evidenceType: string;
    requirementReason: string;
    storageReference: string;
  }[];
}) {
  if (!input.supplyAuthorityAttested || !input.termsAccepted) {
    throw new AppError(
      "VYBE_PROVIDER_ATTESTATION_REQUIRED",
      "Supply authority and provider terms must be explicitly accepted",
      400
    );
  }

  const prisma = getPrismaClient();

  try {
    return await prisma.$transaction(async (tx) => {
      await assertActiveVerifiedAccount(tx, input.applicantUserId);
      await assertOrganizationAuthority(tx, {
        organizationId: input.organizationId,
        userId: input.applicantUserId,
        allowedRoles: ["OWNER", "ADMIN"]
      });

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

      const existingApproval = providerProfile
        ? await tx.vybeProviderApproval.findFirst({
            where: {
              providerProfileId: providerProfile.id,
              category: input.category,
              status: { in: ["ACTIVE", "SUSPENDED", "REVOKED"] }
            },
            select: { status: true }
          })
        : null;

      if (existingApproval) {
        throw new AppError(
          existingApproval.status === "ACTIVE"
            ? "VYBE_PROVIDER_CATEGORY_ALREADY_APPROVED"
            : "VYBE_PROVIDER_CATEGORY_RESTRICTED",
          existingApproval.status === "ACTIVE"
          ? "This organization is already approved for the selected Vybe category"
          : "This category is suspended or revoked and cannot be reapplied for without an administrative resolution",
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
          termsVersion: CURRENT_PROVIDER_TERMS_VERSION,
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

      await enqueueOutboxMessage(tx, {
        aggregateType: "vybe_provider_application",
        aggregateId: application.id,
        eventType: "vybe.provider_application.submitted.v1",
        deduplicationKey:
          `vybe.provider_application:${application.id}:submitted`,
        payload: {
          applicationId: application.id,
          organizationId: application.organizationId,
          category: application.category
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
      }
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
        select: {
          reviewerUserId: true,
          action: true,
          reason: true,
          createdAt: true
        },
        orderBy: { createdAt: "asc" }
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

    await assertIndependentOrganizationReviewer(tx, {
      organizationId: application.organizationId,
      reviewerUserId: input.reviewerUserId
    });

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
          applicationId: application.id,
          status: "PENDING"
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
          "VYBE_PROVIDER_EVIDENCE_NOT_REVIEWABLE",
          "One or more evidence records are missing, already reviewed, or do not belong to this application",
          409
        );
      }
    }

    let approvedId: string | undefined;

    if (input.decision === "APPROVED") {
      if (
        input.expiresAt &&
        new Date(input.expiresAt).getTime() <= Date.now()
      ) {
        throw new AppError(
          "VYBE_PROVIDER_APPROVAL_EXPIRY_INVALID",
          "Approval expiry must be in the future",
          400
        );
      }

      const evidence = await tx.vybeProviderEvidence.findMany({
        where: {
          applicationId: application.id,
          status: { not: "SUPERSEDED" }
        },
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

      const existingRestrictedApproval =
        await tx.vybeProviderApproval.findFirst({
          where: {
            providerProfileId: profile.id,
            category: application.category,
            status: { in: ["ACTIVE", "SUSPENDED", "REVOKED"] }
          },
          select: { status: true }
        });

      if (existingRestrictedApproval) {
        throw new AppError(
          "VYBE_PROVIDER_CATEGORY_RESTRICTED",
          "An existing active, suspended, or revoked approval prevents this application from being approved",
          409
        );
      }

      const locations = application.locations.map(
        ({ city, state, country }) => ({
          city,
          state,
          country
        })
      );

      const approval = await tx.vybeProviderApproval.create({
        data: {
          applicationId: application.id,
          providerProfileId: profile.id,
          category: application.category,
          locations: locations as Prisma.InputJsonValue,
          conditions: (input.conditions ?? []) as Prisma.InputJsonValue,
          approvedByUserId: input.reviewerUserId,
          ...(input.expiresAt ? { expiresAt: new Date(input.expiresAt) } : {})
        }
      });
      approvedId = approval.id;
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

    const action =
      input.decision === "UNDER_REVIEW"
        ? "REVIEW_STARTED"
        : input.decision === "NEEDS_INFORMATION"
          ? "INFORMATION_REQUESTED"
          : input.decision;

    const review = await tx.vybeProviderReview.create({
      data: {
        applicationId: application.id,
        reviewerUserId: input.reviewerUserId,
        action,
        reason: input.reason
      }
    });

    await enqueueOutboxMessage(tx, {
      aggregateType: "vybe_provider_application",
      aggregateId: application.id,
      eventType: "vybe.provider_application.reviewed.v1",
      deduplicationKey:
        `vybe.provider_application:${application.id}:review:${review.id}`,
      payload: {
        applicationId: application.id,
        organizationId: application.organizationId,
        category: application.category,
        decision: input.decision,
        reviewId: review.id
      }
    });

    if (approvedId) {
      await enqueueOutboxMessage(tx, {
        aggregateType: "vybe_provider_approval",
        aggregateId: approvedId,
        eventType: "vybe.provider_approval.granted.v1",
        deduplicationKey: `vybe.provider_approval:${approvedId}:granted`,
        payload: {
          approvalId: approvedId,
          applicationId: application.id,
          organizationId: application.organizationId,
          category: application.category
        }
      });
    }

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
          reason: input.reason,
          evidenceDecisions: (input.evidenceDecisions ?? []).map((item) => ({
            evidenceId: item.evidenceId,
            status: item.status
          }))
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
      throw new AppError(
        "VYBE_PROVIDER_APPLICATION_NOT_FOUND",
        "Vybe provider application was not found",
        404
      );
    }

    if (application.applicantUserId !== input.applicantUserId) {
      throw new AppError(
        "VYBE_PROVIDER_APPLICATION_FORBIDDEN",
        "Only the applicant may add evidence",
        403
      );
    }

    if (application.status !== "NEEDS_INFORMATION") {
      throw new AppError(
        "VYBE_PROVIDER_EVIDENCE_NOT_REQUESTED",
        "Additional evidence can only be submitted after the review team requests information",
        409
      );
    }

    await assertOrganizationAuthority(tx, {
      organizationId: application.organizationId,
      userId: input.applicantUserId,
      allowedRoles: ["OWNER", "ADMIN"]
    });

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
      data: {
        status: "SUBMITTED",
        reviewedAt: null,
        decisionReason: null
      }
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

    await enqueueOutboxMessage(tx, {
      aggregateType: "vybe_provider_application",
      aggregateId: application.id,
      eventType: "vybe.provider_application.evidence_submitted.v1",
      deduplicationKey:
        `vybe.provider_application:${application.id}:evidence:${randomUUID()}`,
      payload: {
        applicationId: application.id,
        organizationId: application.organizationId,
        evidenceCount: created.count
      }
    });

    return tx.vybeProviderEvidence.findMany({
      where: { applicationId: application.id, status: "PENDING" },
      select: {
        id: true,
        evidenceType: true,
        requirementReason: true,
        status: true,
        createdAt: true
      },
      orderBy: { createdAt: "desc" }
    });
  });
}

export async function changeProviderApprovalStatus(input: {
  approvalId: string;
  reviewerUserId: string;
  action: "SUSPENDED" | "REVOKED";
  reason: string;
}) {
  const prisma = getPrismaClient();

  return prisma.$transaction(async (tx) => {
    const approval = await tx.vybeProviderApproval.findUnique({
      where: { id: input.approvalId },
      include: {
        application: {
          select: {
            id: true,
            applicantUserId: true,
            organizationId: true,
            category: true
          }
        }
      }
    });

    if (!approval) {
      throw new AppError(
        "VYBE_PROVIDER_APPROVAL_NOT_FOUND",
        "Vybe provider approval was not found",
        404
      );
    }

    if (approval.application.applicantUserId === input.reviewerUserId) {
      throw new AppError(
        "VYBE_PROVIDER_SELF_REVIEW_FORBIDDEN",
        "Applicants cannot change their own provider approval",
        403
      );
    }

    await assertIndependentOrganizationReviewer(tx, {
      organizationId: approval.application.organizationId,
      reviewerUserId: input.reviewerUserId
    });

    if (input.action === "SUSPENDED" && approval.status !== "ACTIVE") {
      throw new AppError(
        "VYBE_PROVIDER_APPROVAL_NOT_SUSPENDABLE",
        "Only an active approval can be suspended",
        409
      );
    }

    if (
      input.action === "REVOKED" &&
      !["ACTIVE", "SUSPENDED"].includes(approval.status)
    ) {
      throw new AppError(
        "VYBE_PROVIDER_APPROVAL_NOT_REVOCABLE",
        "Only an active or suspended approval can be revoked",
        409
      );
    }

    const updated = await tx.vybeProviderApproval.update({
      where: { id: approval.id },
      data:
        input.action === "SUSPENDED"
          ? {
              status: "SUSPENDED",
              suspendedAt: new Date(),
              suspendedByUserId: input.reviewerUserId,
              suspensionReason: input.reason
            }
          : {
              status: "REVOKED",
              revokedAt: new Date(),
              revokedByUserId: input.reviewerUserId,
              revocationReason: input.reason
            }
    });

    const review = await tx.vybeProviderReview.create({
      data: {
        applicationId: approval.applicationId,
        reviewerUserId: input.reviewerUserId,
        action: input.action,
        reason: input.reason
      }
    });

    await enqueueOutboxMessage(tx, {
      aggregateType: "vybe_provider_approval",
      aggregateId: approval.id,
      eventType: `vybe.provider_approval.${input.action.toLowerCase()}.v1`,
      deduplicationKey:
        `vybe.provider_approval:${approval.id}:review:${review.id}`,
      payload: {
        approvalId: approval.id,
        applicationId: approval.applicationId,
        organizationId: approval.application.organizationId,
        category: approval.category,
        action: input.action,
        reviewId: review.id
      }
    });

    await tx.auditLog.create({
      data: {
        actorId: input.reviewerUserId,
        actorType: "user",
        action: `vybe.provider_approval.${input.action.toLowerCase()}`,
        resourceType: "vybe_provider_approval",
        resourceId: approval.id,
        metadata: {
          applicationId: approval.applicationId,
          organizationId: approval.application.organizationId,
          category: approval.category,
          reason: input.reason
        }
      }
    });

    return updated;
  });
}
