import type { Prisma } from "@prisma/client";

export interface EnqueueOutboxMessageInput {
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  deduplicationKey: string;
  payload: Prisma.InputJsonValue;
}

/**
 * Persist a domain event in the caller's transaction.
 * Consumers can safely retry because every event has a unique deduplication key.
 */
export async function enqueueOutboxMessage(
  tx: Prisma.TransactionClient,
  input: EnqueueOutboxMessageInput
): Promise<void> {
  await tx.outboxMessage.create({ data: input });
}
