CREATE TABLE "outbox_messages" (
    "id" UUID NOT NULL,
    "aggregate_type" TEXT NOT NULL,
    "aggregate_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "deduplication_key" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "available_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "processed_at" TIMESTAMPTZ(6),
    "last_error" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "outbox_messages_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "outbox_messages_deduplication_key_key"
    ON "outbox_messages"("deduplication_key");
CREATE INDEX "outbox_messages_processed_at_available_at_idx"
    ON "outbox_messages"("processed_at", "available_at");
CREATE INDEX "outbox_messages_aggregate_type_aggregate_id_occurred_at_idx"
    ON "outbox_messages"("aggregate_type", "aggregate_id", "occurred_at");

CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "actor_id" TEXT,
    "actor_type" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "resource_type" TEXT NOT NULL,
    "resource_id" TEXT,
    "outcome" TEXT NOT NULL DEFAULT 'success',
    "request_id" TEXT,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "audit_logs_actor_id_occurred_at_idx"
    ON "audit_logs"("actor_id", "occurred_at");
CREATE INDEX "audit_logs_resource_type_resource_id_occurred_at_idx"
    ON "audit_logs"("resource_type", "resource_id", "occurred_at");
CREATE INDEX "audit_logs_action_occurred_at_idx"
    ON "audit_logs"("action", "occurred_at");
