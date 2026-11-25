CREATE TYPE "ticket_type_status" AS ENUM ('ACTIVE', 'PAUSED', 'ARCHIVED');
CREATE TYPE "ticket_hold_status" AS ENUM ('ACTIVE', 'RELEASED', 'EXPIRED', 'CONSUMED');

CREATE TABLE "ticket_types" (
  "id" UUID NOT NULL,
  "event_id" UUID NOT NULL,
  "created_by_user_id" UUID NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "description" VARCHAR(2000),
  "admission_class" VARCHAR(120),
  "status" "ticket_type_status" NOT NULL DEFAULT 'ACTIVE',
  "capacity" INTEGER NOT NULL,
  "issued_quantity" INTEGER NOT NULL DEFAULT 0,
  "sales_starts_at" TIMESTAMPTZ(6),
  "sales_ends_at" TIMESTAMPTZ(6),
  "min_per_order" INTEGER NOT NULL DEFAULT 1,
  "max_per_order" INTEGER NOT NULL DEFAULT 10,
  "current_version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "ticket_types_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ticket_types_capacity_check" CHECK ("capacity" >= 0 AND "issued_quantity" >= 0 AND "issued_quantity" <= "capacity"),
  CONSTRAINT "ticket_types_order_limits_check" CHECK ("min_per_order" >= 1 AND "max_per_order" >= "min_per_order"),
  CONSTRAINT "ticket_types_sales_window_check" CHECK ("sales_ends_at" IS NULL OR "sales_starts_at" IS NULL OR "sales_ends_at" > "sales_starts_at")
);

CREATE TABLE "ticket_type_versions" (
  "id" UUID NOT NULL,
  "ticket_type_id" UUID NOT NULL,
  "version" INTEGER NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "description" VARCHAR(2000),
  "admission_class" VARCHAR(120),
  "unit_price_minor" BIGINT NOT NULL,
  "currency" CHAR(3) NOT NULL,
  "benefits" JSONB NOT NULL DEFAULT '[]',
  "transferable" BOOLEAN NOT NULL DEFAULT false,
  "created_by_user_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ticket_type_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ticket_type_versions_price_check" CHECK ("unit_price_minor" >= 0),
  CONSTRAINT "ticket_type_versions_version_check" CHECK ("version" >= 1)
);

CREATE TABLE "ticket_holds" (
  "id" UUID NOT NULL,
  "event_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "idempotency_key" VARCHAR(128) NOT NULL,
  "checkout_reference" VARCHAR(160),
  "status" "ticket_hold_status" NOT NULL DEFAULT 'ACTIVE',
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "ticket_holds_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ticket_hold_lines" (
  "id" UUID NOT NULL,
  "hold_id" UUID NOT NULL,
  "ticket_type_id" UUID NOT NULL,
  "quantity" INTEGER NOT NULL,
  "type_version" INTEGER NOT NULL,
  "unit_price_minor" BIGINT NOT NULL,
  "currency" CHAR(3) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ticket_hold_lines_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ticket_hold_lines_quantity_check" CHECK ("quantity" > 0),
  CONSTRAINT "ticket_hold_lines_price_check" CHECK ("unit_price_minor" >= 0)
);

CREATE UNIQUE INDEX "ticket_type_versions_ticket_type_id_version_key" ON "ticket_type_versions"("ticket_type_id", "version");
CREATE UNIQUE INDEX "ticket_holds_user_id_idempotency_key_key" ON "ticket_holds"("user_id", "idempotency_key");
CREATE UNIQUE INDEX "ticket_hold_lines_hold_id_ticket_type_id_key" ON "ticket_hold_lines"("hold_id", "ticket_type_id");
CREATE INDEX "ticket_types_event_id_status_sales_starts_at_sales_ends_at_idx" ON "ticket_types"("event_id", "status", "sales_starts_at", "sales_ends_at");
CREATE INDEX "ticket_types_created_by_user_id_created_at_idx" ON "ticket_types"("created_by_user_id", "created_at");
CREATE INDEX "ticket_type_versions_ticket_type_id_created_at_idx" ON "ticket_type_versions"("ticket_type_id", "created_at");
CREATE INDEX "ticket_holds_event_id_status_expires_at_idx" ON "ticket_holds"("event_id", "status", "expires_at");
CREATE INDEX "ticket_holds_user_id_status_expires_at_idx" ON "ticket_holds"("user_id", "status", "expires_at");
CREATE INDEX "ticket_hold_lines_ticket_type_id_hold_id_idx" ON "ticket_hold_lines"("ticket_type_id", "hold_id");

ALTER TABLE "ticket_types" ADD CONSTRAINT "ticket_types_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ticket_types" ADD CONSTRAINT "ticket_types_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ticket_type_versions" ADD CONSTRAINT "ticket_type_versions_ticket_type_id_fkey" FOREIGN KEY ("ticket_type_id") REFERENCES "ticket_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ticket_holds" ADD CONSTRAINT "ticket_holds_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ticket_holds" ADD CONSTRAINT "ticket_holds_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ticket_hold_lines" ADD CONSTRAINT "ticket_hold_lines_hold_id_fkey" FOREIGN KEY ("hold_id") REFERENCES "ticket_holds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ticket_hold_lines" ADD CONSTRAINT "ticket_hold_lines_ticket_type_id_fkey" FOREIGN KEY ("ticket_type_id") REFERENCES "ticket_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
