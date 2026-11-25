import type {
  OrganizationMembershipRole,
  Prisma
} from "@prisma/client";
import { AppError } from "../../shared/errors/app-error.js";

/**
 * Organization-owned authority contract for domain application workflows.
 */
export async function assertOrganizationAuthority(
  tx: Prisma.TransactionClient,
  input: {
    organizationId: string;
    userId: string;
    allowedRoles: OrganizationMembershipRole[];
  }
): Promise<void> {
  const membership = await tx.organizationMembership.findUnique({
    where: {
      organizationId_userId: {
        organizationId: input.organizationId,
        userId: input.userId
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
    !input.allowedRoles.includes(membership.role) ||
    membership.organization.status !== "ACTIVE"
  ) {
    throw new AppError(
      "ORGANIZATION_AUTHORITY_REQUIRED",
      "An active, authorized organization member is required",
      403
    );
  }
}

/**
 * Prevent reviewers with any current or historical organization membership
 * from deciding applications submitted by that organization.
 */
export async function assertIndependentOrganizationReviewer(
  tx: Prisma.TransactionClient,
  input: { organizationId: string; reviewerUserId: string }
): Promise<void> {
  const membership = await tx.organizationMembership.findUnique({
    where: {
      organizationId_userId: {
        organizationId: input.organizationId,
        userId: input.reviewerUserId
      }
    },
    select: { id: true }
  });

  if (membership) {
    throw new AppError(
      "ORGANIZATION_CONFLICTED_REVIEWER",
      "Organization members and former members cannot review this provider",
      403
    );
  }
}
