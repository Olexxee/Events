import type { OrganizerApplicationStatus } from "@prisma/client";
import { AppError } from "../../shared/errors/app-error.js";
import { getPrismaClient } from "../../infrastructure/database/prisma.js";

const ACTIVE_APPLICATION_STATUSES: OrganizerApplicationStatus[] = [
  "SUBMITTED",
  "UNDER_REVIEW",
  "NEEDS_INFORMATION"
];

export async function submitOrganizerApplication(input: {
  organizationId: string;
  applicantUserId: string;
  applicationMessage: string;
  websiteUrl?: string;
}) {
  const prisma = getPrismaClient();

  try {
    return await prisma.$transaction(async (tx) => {
      const membership = await tx.organizationMembership.findUnique({
        where: {
          organizationId_userId: {
            organizationId: input.organizationId,
            userId: input.applicantUserId
          }
        },
        select: {
          role: true,
          status: true,
          organization: { select: { status: true } }
        }
      });

      if (
        !membership ||
        membership.status !== "ACTIVE" ||
        membership.role !== "OWNER" ||
        membership.organization.status !== "ACTIVE"
      ) {
        throw new AppError(
          "ORGANIZER_APPLICATION_FORBIDDEN",
          "Only an active organization owner can apply for organizer access",
          403
        );
      }

      const existing = await tx.organizerApplication.findFirst({
        where: {
          organizationId: input.organizationId,
          status: { in: ACTIVE_APPLICATION_STATUSES }
        },
        select: { id: true }
      });

      if (existing) {
        throw new AppError(
          "ORGANIZER_APPLICATION_ALREADY_PENDING",
          "This organization already has an application awaiting a decision",
          409
        );
      }

      const application = await tx.organizerApplication.create({
        data: {
          organizationId: input.organizationId,
          applicantUserId: input.applicantUserId,
          applicationMessage: input.applicationMessage,
          ...(input.websiteUrl ? { websiteUrl: input.websiteUrl } : {})
        },
        select: {
          id: true,
          organizationId: true,
          status: true,
          applicationMessage: true,
          websiteUrl: true,
          submittedAt: true
        }
      });

      await tx.auditLog.create({
        data: {
          actorId: input.applicantUserId,
          actorType: "user",
          action: "organizer.application.submitted",
          resourceType: "organizer_application",
          resourceId: application.id,
          metadata: { organizationId: input.organizationId }
        }
      });

      return application;
    });
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error.code === "P2002" || error.code === "23505")
    ) {
      throw new AppError(
        "ORGANIZER_APPLICATION_ALREADY_PENDING",
        "This organization already has an application awaiting a decision",
        409
      );
    }
    throw error;
  }
}

export async function listMyOrganizerApplications(userId: string) {
  return getPrismaClient().organizerApplication.findMany({
    where: { applicantUserId: userId },
    select: {
      id: true,
      organizationId: true,
      status: true,
      applicationMessage: true,
      websiteUrl: true,
      submittedAt: true,
      reviewedAt: true,
      decisionReason: true,
      organization: { select: { name: true, slug: true } }
    },
    orderBy: { submittedAt: "desc" }
  });
}

export async function listOrganizerApplications() {
  return getPrismaClient().organizerApplication.findMany({
    select: {
      id: true,
      organizationId: true,
      applicantUserId: true,
      status: true,
      applicationMessage: true,
      websiteUrl: true,
      submittedAt: true,
      reviewedAt: true,
      decisionReason: true,
      organization: { select: { name: true, slug: true } },
      applicant: {
        select: {
          id: true,
          email: true,
          profile: { select: { displayName: true, phone: true } }
        }
      }
    },
    orderBy: { submittedAt: "asc" }
  });
}

export async function decideOrganizerApplication(input: {
  applicationId: string;
  reviewerUserId: string;
  decision: "APPROVED" | "REJECTED";
  reason: string;
}) {
  const prisma = getPrismaClient();

  return prisma.$transaction(async (tx) => {
    const changed = await tx.organizerApplication.updateMany({
      where: {
        id: input.applicationId,
        status: { in: ACTIVE_APPLICATION_STATUSES }
      },
      data: {
        status: input.decision,
        reviewedAt: new Date(),
        reviewedByUserId: input.reviewerUserId,
        decisionReason: input.reason
      }
    });

    if (changed.count !== 1) {
      const existing = await tx.organizerApplication.findUnique({
        where: { id: input.applicationId },
        select: { id: true }
      });
      if (!existing) {
        throw new AppError(
          "ORGANIZER_APPLICATION_NOT_FOUND",
          "Organizer application was not found",
          404
        );
      }
      throw new AppError(
        "ORGANIZER_APPLICATION_NOT_REVIEWABLE",
        "This application has already received a final decision or is not reviewable",
        409
      );
    }

    const application = await tx.organizerApplication.findUniqueOrThrow({
      where: { id: input.applicationId },
      select: {
        id: true,
        organizationId: true,
        applicantUserId: true,
        status: true,
        reviewedAt: true,
        reviewedByUserId: true,
        decisionReason: true
      }
    });

    await tx.auditLog.create({
      data: {
        actorId: input.reviewerUserId,
        actorType: "user",
        action: `organizer.application.${input.decision.toLowerCase()}`,
        resourceType: "organizer_application",
        resourceId: application.id,
        metadata: {
          organizationId: application.organizationId,
          applicantUserId: application.applicantUserId,
          reason: input.reason
        }
      }
    });

    return application;
  });
}
