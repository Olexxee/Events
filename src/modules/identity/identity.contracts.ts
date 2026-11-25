import type { Prisma } from "@prisma/client";
import { AppError } from "../../shared/errors/app-error.js";

/**
 * Identity-owned account eligibility contract for other domains.
 * The caller supplies its transaction so account eligibility is checked
 * atomically with the requesting domain's write.
 */
export async function assertActiveVerifiedAccount(
  tx: Prisma.TransactionClient,
  userId: string
): Promise<void> {
  const user = await tx.user.findUnique({
    where: { id: userId },
    select: { status: true, emailVerifiedAt: true }
  });

  if (!user || user.status !== "ACTIVE" || !user.emailVerifiedAt) {
    throw new AppError(
      "VERIFIED_ACTIVE_ACCOUNT_REQUIRED",
      "A verified, active account is required",
      403
    );
  }
}
