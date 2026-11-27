ALTER TYPE "vybe_inventory_hold_status" ADD VALUE 'CONVERTED';
ALTER TYPE "vybe_time_slot_hold_status" ADD VALUE 'CONVERTED';

CREATE TYPE "vybe_time_slot_resource_occupancy_status" AS ENUM ('HELD', 'COMMITTED', 'RELEASED', 'EXPIRED');
CREATE TYPE "vybe_booking_status" AS ENUM ('CONFIRMED', 'CANCELLED', 'COMPLETED', 'NO_SHOW');
CREATE TYPE "vybe_booking_source_type" AS ENUM ('QUANTITY_POOL', 'CAPACITY_SESSION', 'EXCLUSIVE_RESOURCE');

CREATE TABLE "vybe_bookings" (
  "id" UUID NOT NULL,
  "public_reference" VARCHAR(32) NOT NULL,
  "customer_user_id" UUID NOT NULL,
  "provider_profile_id" UUID NOT NULL,
  "provider_organization_id" UUID NOT NULL,
  "offering_id" UUID NOT NULL,
  "offering_version" INTEGER NOT NULL,
  "source_type" "vybe_booking_source_type" NOT NULL,
  "inventory_hold_id" UUID,
  "time_slot_hold_id" UUID,
  "status" "vybe_booking_status" NOT NULL DEFAULT 'CONFIRMED',
  "service_starts_at" TIMESTAMPTZ(6) NOT NULL,
  "service_ends_at" TIMESTAMPTZ(6) NOT NULL,
  "blocked_starts_at" TIMESTAMPTZ(6) NOT NULL,
  "blocked_ends_at" TIMESTAMPTZ(6) NOT NULL,
  "timezone" VARCHAR(80) NOT NULL,
  "quantity" INTEGER,
  "resource_id" UUID,
  "offering_snapshot" JSONB NOT NULL,
  "price_quote_snapshot" JSONB NOT NULL,
  "accepted_terms_snapshot" JSONB NOT NULL,
  "external_order_item_reference" VARCHAR(180),
  "confirmed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "cancelled_at" TIMESTAMPTZ(6),
  "completed_at" TIMESTAMPTZ(6),
  "no_show_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "vybe_bookings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "vybe_bookings_source_xor_check" CHECK (
    ("source_type" = 'QUANTITY_POOL' AND "inventory_hold_id" IS NOT NULL AND "time_slot_hold_id" IS NULL AND "quantity" > 0 AND "resource_id" IS NULL)
    OR ("source_type" = 'CAPACITY_SESSION' AND "inventory_hold_id" IS NULL AND "time_slot_hold_id" IS NOT NULL AND "quantity" > 0 AND "resource_id" IS NULL)
    OR ("source_type" = 'EXCLUSIVE_RESOURCE' AND "inventory_hold_id" IS NULL AND "time_slot_hold_id" IS NOT NULL AND "quantity" IS NULL AND "resource_id" IS NOT NULL)
  ),
  CONSTRAINT "vybe_bookings_service_interval_check" CHECK ("service_starts_at" < "service_ends_at"),
  CONSTRAINT "vybe_bookings_blocked_interval_check" CHECK (
    "blocked_starts_at" < "blocked_ends_at"
    AND "blocked_starts_at" <= "service_starts_at"
    AND "blocked_ends_at" >= "service_ends_at"
  ),
  CONSTRAINT "vybe_bookings_offering_version_positive_check" CHECK ("offering_version" > 0),
  CONSTRAINT "vybe_bookings_quote_snapshot_check" CHECK (
    jsonb_typeof("price_quote_snapshot") = 'object'
    AND "price_quote_snapshot" ? 'quoteReference'
    AND "price_quote_snapshot" ? 'amountMinor'
    AND "price_quote_snapshot" ? 'currency'
  )
);

CREATE TABLE "vybe_booking_status_history" (
  "id" UUID NOT NULL,
  "booking_id" UUID NOT NULL,
  "from_status" "vybe_booking_status",
  "to_status" "vybe_booking_status" NOT NULL,
  "actor_user_id" UUID,
  "actor_type" VARCHAR(40) NOT NULL,
  "reason" VARCHAR(1000),
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "vybe_booking_status_history_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "vybe_time_slot_resource_occupancies" (
  "id" UUID NOT NULL,
  "resource_id" UUID NOT NULL,
  "occurrence_id" UUID NOT NULL,
  "source_hold_id" UUID NOT NULL,
  "booking_id" UUID,
  "status" "vybe_time_slot_resource_occupancy_status" NOT NULL DEFAULT 'HELD',
  "blocked_starts_at" TIMESTAMPTZ(6) NOT NULL,
  "blocked_ends_at" TIMESTAMPTZ(6) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "vybe_time_slot_resource_occupancies_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "vybe_time_slot_resource_occupancies_interval_check" CHECK ("blocked_starts_at" < "blocked_ends_at"),
  CONSTRAINT "vybe_time_slot_resource_occupancies_state_booking_check" CHECK (
    ("status" = 'COMMITTED' AND "booking_id" IS NOT NULL)
    OR ("status" <> 'COMMITTED' AND "booking_id" IS NULL)
  )
);

CREATE UNIQUE INDEX "vybe_bookings_public_reference_key" ON "vybe_bookings"("public_reference");
CREATE UNIQUE INDEX "vybe_bookings_inventory_hold_id_key" ON "vybe_bookings"("inventory_hold_id");
CREATE UNIQUE INDEX "vybe_bookings_time_slot_hold_id_key" ON "vybe_bookings"("time_slot_hold_id");
CREATE UNIQUE INDEX "vybe_bookings_external_order_item_reference_key" ON "vybe_bookings"("external_order_item_reference");
CREATE INDEX "vybe_bookings_customer_created_idx" ON "vybe_bookings"("customer_user_id", "created_at");
CREATE INDEX "vybe_bookings_provider_status_start_idx" ON "vybe_bookings"("provider_profile_id", "status", "service_starts_at");
CREATE INDEX "vybe_bookings_org_status_start_idx" ON "vybe_bookings"("provider_organization_id", "status", "service_starts_at");
CREATE INDEX "vybe_bookings_status_start_idx" ON "vybe_bookings"("status", "service_starts_at");
CREATE INDEX "vybe_booking_status_history_booking_occurred_idx" ON "vybe_booking_status_history"("booking_id", "occurred_at");
CREATE INDEX "vybe_booking_status_history_actor_occurred_idx" ON "vybe_booking_status_history"("actor_user_id", "occurred_at");
CREATE UNIQUE INDEX "vybe_time_slot_resource_occupancies_source_hold_key" ON "vybe_time_slot_resource_occupancies"("source_hold_id");
CREATE UNIQUE INDEX "vybe_time_slot_resource_occupancies_booking_key" ON "vybe_time_slot_resource_occupancies"("booking_id");
CREATE INDEX "vybe_time_slot_resource_occupancies_occurrence_status_idx" ON "vybe_time_slot_resource_occupancies"("occurrence_id", "status");
CREATE INDEX "vybe_time_slot_resource_occupancies_resource_status_start_idx" ON "vybe_time_slot_resource_occupancies"("resource_id", "status", "blocked_starts_at");

ALTER TABLE "vybe_bookings"
  ADD CONSTRAINT "vybe_bookings_customer_fkey" FOREIGN KEY ("customer_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "vybe_bookings_provider_profile_fkey" FOREIGN KEY ("provider_profile_id") REFERENCES "vybe_provider_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "vybe_bookings_provider_organization_fkey" FOREIGN KEY ("provider_organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "vybe_bookings_offering_fkey" FOREIGN KEY ("offering_id") REFERENCES "vybe_offerings"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "vybe_bookings_inventory_hold_fkey" FOREIGN KEY ("inventory_hold_id") REFERENCES "vybe_inventory_holds"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "vybe_bookings_time_slot_hold_fkey" FOREIGN KEY ("time_slot_hold_id") REFERENCES "vybe_time_slot_holds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "vybe_booking_status_history"
  ADD CONSTRAINT "vybe_booking_status_history_booking_fkey" FOREIGN KEY ("booking_id") REFERENCES "vybe_bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "vybe_booking_status_history_actor_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "vybe_time_slot_resource_occupancies"
  ADD CONSTRAINT "vybe_time_slot_resource_occupancies_resource_fkey" FOREIGN KEY ("resource_id") REFERENCES "vybe_time_slot_resources"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "vybe_time_slot_resource_occupancies_occurrence_fkey" FOREIGN KEY ("occurrence_id") REFERENCES "vybe_time_slot_occurrences"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "vybe_time_slot_resource_occupancies_source_hold_fkey" FOREIGN KEY ("source_hold_id") REFERENCES "vybe_time_slot_holds"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "vybe_time_slot_resource_occupancies_booking_fkey" FOREIGN KEY ("booking_id") REFERENCES "vybe_bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill every row still marked ACTIVE. Do not filter by expires_at: the current
-- hold implementation expires synchronously, and an ACTIVE row remains protected
-- by the legacy exclusion constraint until it is explicitly transitioned.
INSERT INTO "vybe_time_slot_resource_occupancies" (
  "id", "resource_id", "occurrence_id", "source_hold_id", "status",
  "blocked_starts_at", "blocked_ends_at", "created_at", "updated_at"
)
SELECT gen_random_uuid(), hold."resource_id", hold."occurrence_id", hold."id", 'HELD',
       hold."blocked_starts_at", hold."blocked_ends_at", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  FROM "vybe_time_slot_holds" hold
 WHERE hold."status" = 'ACTIVE' AND hold."resource_id" IS NOT NULL;

-- Refuse to proceed if legacy active exclusive holds were not fully represented.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "vybe_time_slot_holds" hold
    LEFT JOIN "vybe_time_slot_resource_occupancies" occupancy
      ON occupancy."source_hold_id" = hold."id"
    WHERE hold."status" = 'ACTIVE' AND hold."resource_id" IS NOT NULL
      AND occupancy."id" IS NULL
  ) THEN
    RAISE EXCEPTION 'Vybe exclusive hold occupancy backfill is incomplete';
  END IF;
END;
$$;

-- HELD and COMMITTED share one exclusion domain. The old hold-table exclusion
-- remains in place for the full expand phase; do not remove it in this migration.
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE "vybe_time_slot_resource_occupancies"
  ADD CONSTRAINT "vybe_time_slot_resource_occupancies_no_overlap"
  EXCLUDE USING gist (
    "resource_id" WITH =,
    tstzrange("blocked_starts_at", "blocked_ends_at", '[)') WITH &&
  )
  WHERE ("status" IN ('HELD', 'COMMITTED'));

-- Cross-table source integrity is checked in PostgreSQL, not trusted to callers.
CREATE OR REPLACE FUNCTION vybe_validate_booking_source()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  source_user UUID;
  source_offering UUID;
  source_resource UUID;
  source_mode "vybe_time_slot_inventory_mode";
  source_profile UUID;
  source_org UUID;
BEGIN
  SELECT offering."provider_profile_id", profile."organization_id"
    INTO source_profile, source_org
    FROM "vybe_offerings" offering
    JOIN "vybe_provider_profiles" profile ON profile."id" = offering."provider_profile_id"
   WHERE offering."id" = NEW."offering_id";

  IF source_profile IS NULL OR source_profile <> NEW."provider_profile_id"
     OR source_org <> NEW."provider_organization_id" THEN
    RAISE EXCEPTION 'booking provider and offering ownership do not match' USING ERRCODE = '23514';
  END IF;

  IF NEW."source_type" = 'QUANTITY_POOL' THEN
    SELECT hold."user_id", pool."offering_id"
      INTO source_user, source_offering
      FROM "vybe_inventory_holds" hold
      JOIN "vybe_inventory_pools" pool ON pool."id" = hold."pool_id"
     WHERE hold."id" = NEW."inventory_hold_id";
  ELSE
    SELECT hold."user_id", occurrence."offering_id", hold."resource_id", occurrence."inventory_mode"
      INTO source_user, source_offering, source_resource, source_mode
      FROM "vybe_time_slot_holds" hold
      JOIN "vybe_time_slot_occurrences" occurrence ON occurrence."id" = hold."occurrence_id"
     WHERE hold."id" = NEW."time_slot_hold_id";
  END IF;

  IF source_user IS NULL OR source_user <> NEW."customer_user_id"
     OR source_offering <> NEW."offering_id" THEN
    RAISE EXCEPTION 'booking source hold owner or offering does not match' USING ERRCODE = '23514';
  END IF;

  IF NEW."source_type" = 'CAPACITY_SESSION' AND
     (source_mode <> 'CAPACITY' OR NEW."quantity" IS NULL) THEN
    RAISE EXCEPTION 'capacity booking requires a capacity-session hold' USING ERRCODE = '23514';
  END IF;

  IF NEW."source_type" = 'EXCLUSIVE_RESOURCE' AND
     (source_mode <> 'EXCLUSIVE' OR source_resource IS DISTINCT FROM NEW."resource_id") THEN
    RAISE EXCEPTION 'exclusive booking requires the held resource' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;
CREATE TRIGGER "vybe_bookings_source_integrity_guard"
BEFORE INSERT OR UPDATE OF "customer_user_id", "provider_profile_id", "provider_organization_id",
  "offering_id", "source_type", "inventory_hold_id", "time_slot_hold_id", "quantity", "resource_id"
ON "vybe_bookings"
FOR EACH ROW EXECUTE FUNCTION vybe_validate_booking_source();

CREATE OR REPLACE FUNCTION vybe_validate_resource_occupancy_source()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  hold_resource UUID;
  hold_occurrence UUID;
  hold_start TIMESTAMPTZ;
  hold_end TIMESTAMPTZ;
  occurrence_mode "vybe_time_slot_inventory_mode";
BEGIN
  SELECT hold."resource_id", hold."occurrence_id", hold."blocked_starts_at", hold."blocked_ends_at",
         occurrence."inventory_mode"
    INTO hold_resource, hold_occurrence, hold_start, hold_end, occurrence_mode
    FROM "vybe_time_slot_holds" hold
    JOIN "vybe_time_slot_occurrences" occurrence ON occurrence."id" = hold."occurrence_id"
   WHERE hold."id" = NEW."source_hold_id";

  IF hold_resource IS NULL OR occurrence_mode <> 'EXCLUSIVE'
     OR hold_resource <> NEW."resource_id" OR hold_occurrence <> NEW."occurrence_id"
     OR hold_start <> NEW."blocked_starts_at" OR hold_end <> NEW."blocked_ends_at" THEN
    RAISE EXCEPTION 'occupancy must exactly represent its exclusive source hold' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;
CREATE TRIGGER "vybe_resource_occupancy_source_guard"
BEFORE INSERT OR UPDATE OF "resource_id", "occurrence_id", "source_hold_id", "blocked_starts_at", "blocked_ends_at"
ON "vybe_time_slot_resource_occupancies"
FOR EACH ROW EXECUTE FUNCTION vybe_validate_resource_occupancy_source();

-- Status history is append-only; booking transition logic is added in a later slice.
CREATE OR REPLACE FUNCTION vybe_reject_booking_history_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Vybe booking status history is append-only' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER "vybe_booking_status_history_immutable"
BEFORE UPDATE OR DELETE ON "vybe_booking_status_history"
FOR EACH ROW EXECUTE FUNCTION vybe_reject_booking_history_mutation();
