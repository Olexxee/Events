-- VYBE-014: accommodation room-night inventory (schema slice A).
CREATE TYPE "vybe_accommodation_property_status" AS ENUM ('ACTIVE', 'PAUSED');
CREATE TYPE "vybe_accommodation_room_category_status" AS ENUM ('ACTIVE', 'PAUSED');
CREATE TYPE "vybe_accommodation_allocation_status" AS ENUM ('ACTIVE', 'PAUSED', 'RELEASED');
CREATE TYPE "vybe_accommodation_hold_status" AS ENUM ('ACTIVE', 'RELEASED', 'EXPIRED');

CREATE UNIQUE INDEX "vybe_offerings_id_provider_profile_key"
  ON "vybe_offerings" ("id", "provider_profile_id");

CREATE TABLE "vybe_accommodation_properties" (
  "id" UUID NOT NULL,
  "provider_profile_id" UUID NOT NULL,
  "provider_property_key" VARCHAR(120) NOT NULL,
  "name" VARCHAR(180) NOT NULL,
  "address_line" VARCHAR(300),
  "city" VARCHAR(100) NOT NULL,
  "state" VARCHAR(100) NOT NULL,
  "country" VARCHAR(100) NOT NULL,
  "postal_code" VARCHAR(32),
  "timezone" VARCHAR(80) NOT NULL,
  "status" "vybe_accommodation_property_status" NOT NULL DEFAULT 'ACTIVE',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "vybe_accommodation_properties_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "vybe_accommodation_properties_provider_fkey"
    FOREIGN KEY ("provider_profile_id") REFERENCES "vybe_provider_profiles"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "vybe_accommodation_properties_provider_key"
    UNIQUE ("provider_profile_id", "provider_property_key"),
  CONSTRAINT "vybe_accommodation_properties_id_provider_key"
    UNIQUE ("id", "provider_profile_id"),
  CONSTRAINT "vybe_accommodation_properties_timezone_check"
    CHECK (length(btrim("timezone")) > 0)
);

CREATE INDEX "vybe_accommodation_properties_provider_status_idx"
  ON "vybe_accommodation_properties" ("provider_profile_id", "status");

CREATE TABLE "vybe_accommodation_room_categories" (
  "id" UUID NOT NULL,
  "provider_profile_id" UUID NOT NULL,
  "property_id" UUID NOT NULL,
  "provider_category_key" VARCHAR(120) NOT NULL,
  "name" VARCHAR(160) NOT NULL,
  "description" VARCHAR(1000),
  "max_occupancy" INTEGER NOT NULL,
  "specifications" JSONB NOT NULL DEFAULT '{}',
  "status" "vybe_accommodation_room_category_status" NOT NULL DEFAULT 'ACTIVE',
  "offering_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "vybe_accommodation_room_categories_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "vybe_accommodation_room_categories_provider_fkey"
    FOREIGN KEY ("provider_profile_id") REFERENCES "vybe_provider_profiles"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "vybe_accommodation_room_categories_property_provider_fkey"
    FOREIGN KEY ("property_id", "provider_profile_id")
    REFERENCES "vybe_accommodation_properties"("id", "provider_profile_id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "vybe_accommodation_room_categories_offering_provider_fkey"
    FOREIGN KEY ("offering_id", "provider_profile_id")
    REFERENCES "vybe_offerings"("id", "provider_profile_id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "vybe_accommodation_room_categories_property_key"
    UNIQUE ("property_id", "provider_category_key"),
  CONSTRAINT "vybe_accommodation_room_categories_offering_id_key"
    UNIQUE ("offering_id"),
  CONSTRAINT "vybe_accommodation_room_categories_id_provider_key"
    UNIQUE ("id", "provider_profile_id"),
  CONSTRAINT "vybe_accommodation_room_categories_occupancy_check"
    CHECK ("max_occupancy" > 0),
  CONSTRAINT "vybe_accommodation_room_categories_specifications_object_check"
    CHECK (jsonb_typeof("specifications") = 'object')
);

CREATE INDEX "vybe_accommodation_room_categories_provider_status_idx"
  ON "vybe_accommodation_room_categories" ("provider_profile_id", "status");

CREATE TABLE "vybe_accommodation_allocations" (
  "id" UUID NOT NULL,
  "room_category_id" UUID NOT NULL,
  "start_date" DATE NOT NULL,
  "end_date" DATE NOT NULL,
  "release_cutoff_at" TIMESTAMPTZ(6) NOT NULL,
  "release_cutoff_local" VARCHAR(40) NOT NULL,
  "release_cutoff_timezone" VARCHAR(80) NOT NULL,
  "agreement_reference" VARCHAR(500) NOT NULL,
  "terms_version" VARCHAR(80) NOT NULL,
  "evidence_reference" VARCHAR(1000) NOT NULL,
  "status" "vybe_accommodation_allocation_status" NOT NULL DEFAULT 'ACTIVE',
  "created_by_user_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "vybe_accommodation_allocations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "vybe_accommodation_allocations_category_fkey"
    FOREIGN KEY ("room_category_id") REFERENCES "vybe_accommodation_room_categories"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "vybe_accommodation_allocations_creator_fkey"
    FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "vybe_accommodation_allocations_id_category_key"
    UNIQUE ("id", "room_category_id"),
  CONSTRAINT "vybe_accommodation_allocations_date_range_check"
    CHECK ("start_date" < "end_date"),
  CONSTRAINT "vybe_accommodation_allocations_cutoff_local_check"
    CHECK ("release_cutoff_local" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9](\\.[0-9]{1,6})?)?([+-]([01][0-9]|2[0-3]):[0-5][0-9]|Z)$'),
  CONSTRAINT "vybe_accommodation_allocations_cutoff_timezone_check"
    CHECK (length(btrim("release_cutoff_timezone")) > 0),
  CONSTRAINT "vybe_accommodation_allocations_agreement_check"
    CHECK (length(btrim("agreement_reference")) > 0 AND length(btrim("terms_version")) > 0
      AND length(btrim("evidence_reference")) > 0)
);

CREATE INDEX "vybe_accommodation_allocations_category_cutoff_idx"
  ON "vybe_accommodation_allocations" ("room_category_id", "status", "release_cutoff_at");

CREATE TABLE "vybe_accommodation_night_locks" (
  "id" UUID NOT NULL,
  "room_category_id" UUID NOT NULL,
  "stay_date" DATE NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "vybe_accommodation_night_locks_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "vybe_accommodation_night_locks_category_fkey"
    FOREIGN KEY ("room_category_id") REFERENCES "vybe_accommodation_room_categories"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "vybe_accommodation_night_locks_category_date_key"
    UNIQUE ("room_category_id", "stay_date")
);

CREATE TABLE "vybe_accommodation_allocation_nights" (
  "id" UUID NOT NULL,
  "allocation_id" UUID NOT NULL,
  "room_category_id" UUID NOT NULL,
  "stay_date" DATE NOT NULL,
  "allocated_quantity" INTEGER NOT NULL,
  "committed_quantity" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "vybe_accommodation_allocation_nights_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "vybe_accommodation_allocation_nights_allocation_category_fkey"
    FOREIGN KEY ("allocation_id", "room_category_id")
    REFERENCES "vybe_accommodation_allocations"("id", "room_category_id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "vybe_accommodation_allocation_nights_lock_fkey"
    FOREIGN KEY ("room_category_id", "stay_date")
    REFERENCES "vybe_accommodation_night_locks"("room_category_id", "stay_date")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "vybe_accommodation_allocation_nights_allocation_date_key"
    UNIQUE ("allocation_id", "stay_date"),
  CONSTRAINT "vybe_accommodation_allocation_nights_id_category_date_key"
    UNIQUE ("id", "room_category_id", "stay_date"),
  CONSTRAINT "vybe_accommodation_allocation_nights_quantity_check"
    CHECK ("allocated_quantity" > 0 AND "committed_quantity" >= 0
      AND "committed_quantity" <= "allocated_quantity")
);

CREATE INDEX "vybe_accommodation_allocation_nights_category_date_idx"
  ON "vybe_accommodation_allocation_nights" ("room_category_id", "stay_date");

CREATE TABLE "vybe_accommodation_allocation_adjustments" (
  "id" UUID NOT NULL,
  "allocation_night_id" UUID NOT NULL,
  "actor_user_id" UUID NOT NULL,
  "quantity_delta" INTEGER NOT NULL,
  "reason" VARCHAR(1000) NOT NULL,
  "evidence_reference" VARCHAR(1000) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "vybe_accommodation_allocation_adjustments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "vybe_accommodation_allocation_adjustments_night_fkey"
    FOREIGN KEY ("allocation_night_id") REFERENCES "vybe_accommodation_allocation_nights"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "vybe_accommodation_allocation_adjustments_actor_fkey"
    FOREIGN KEY ("actor_user_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "vybe_accommodation_allocation_adjustments_delta_check"
    CHECK ("quantity_delta" <> 0),
  CONSTRAINT "vybe_accommodation_allocation_adjustments_reason_check"
    CHECK (length(btrim("reason")) > 0 AND length(btrim("evidence_reference")) > 0)
);

CREATE INDEX "vybe_accommodation_adjustments_night_created_idx"
  ON "vybe_accommodation_allocation_adjustments" ("allocation_night_id", "created_at");
CREATE INDEX "vybe_accommodation_adjustments_actor_created_idx"
  ON "vybe_accommodation_allocation_adjustments" ("actor_user_id", "created_at");

CREATE TABLE "vybe_accommodation_holds" (
  "id" UUID NOT NULL,
  "room_category_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "idempotency_key" VARCHAR(128) NOT NULL,
  "request_hash" CHAR(64) NOT NULL,
  "check_in_date" DATE NOT NULL,
  "check_out_date" DATE NOT NULL,
  "room_quantity" INTEGER NOT NULL,
  "status" "vybe_accommodation_hold_status" NOT NULL DEFAULT 'ACTIVE',
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "snapshot" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "vybe_accommodation_holds_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "vybe_accommodation_holds_category_fkey"
    FOREIGN KEY ("room_category_id") REFERENCES "vybe_accommodation_room_categories"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "vybe_accommodation_holds_user_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "vybe_accommodation_holds_user_idempotency_key"
    UNIQUE ("user_id", "idempotency_key"),
  CONSTRAINT "vybe_accommodation_holds_id_category_key"
    UNIQUE ("id", "room_category_id"),
  CONSTRAINT "vybe_accommodation_holds_date_range_check"
    CHECK ("check_in_date" < "check_out_date"),
  CONSTRAINT "vybe_accommodation_holds_quantity_check"
    CHECK ("room_quantity" > 0),
  CONSTRAINT "vybe_accommodation_holds_request_hash_check"
    CHECK ("request_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "vybe_accommodation_holds_snapshot_object_check"
    CHECK (jsonb_typeof("snapshot") = 'object'),
  CONSTRAINT "vybe_accommodation_holds_idempotency_check"
    CHECK (length(btrim("idempotency_key")) > 0)
);

CREATE INDEX "vybe_accommodation_holds_category_status_expiry_idx"
  ON "vybe_accommodation_holds" ("room_category_id", "status", "expires_at");
CREATE INDEX "vybe_accommodation_holds_user_status_expiry_idx"
  ON "vybe_accommodation_holds" ("user_id", "status", "expires_at");

CREATE TABLE "vybe_accommodation_hold_nights" (
  "id" UUID NOT NULL,
  "hold_id" UUID NOT NULL,
  "allocation_night_id" UUID NOT NULL,
  "room_category_id" UUID NOT NULL,
  "stay_date" DATE NOT NULL,
  "quantity" INTEGER NOT NULL,
  "release_cutoff_at_snapshot" TIMESTAMPTZ(6) NOT NULL,
  "release_cutoff_local_snapshot" VARCHAR(40) NOT NULL,
  "release_cutoff_timezone_snapshot" VARCHAR(80) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "vybe_accommodation_hold_nights_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "vybe_accommodation_hold_nights_hold_category_fkey"
    FOREIGN KEY ("hold_id", "room_category_id")
    REFERENCES "vybe_accommodation_holds"("id", "room_category_id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "vybe_accommodation_hold_nights_allocation_category_date_fkey"
    FOREIGN KEY ("allocation_night_id", "room_category_id", "stay_date")
    REFERENCES "vybe_accommodation_allocation_nights"("id", "room_category_id", "stay_date")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "vybe_accommodation_hold_nights_hold_allocation_key"
    UNIQUE ("hold_id", "allocation_night_id"),
  CONSTRAINT "vybe_accommodation_hold_nights_quantity_check"
    CHECK ("quantity" > 0),
  CONSTRAINT "vybe_accommodation_hold_nights_cutoff_snapshot_check"
    CHECK (length(btrim("release_cutoff_local_snapshot")) > 0
      AND length(btrim("release_cutoff_timezone_snapshot")) > 0)
);

CREATE INDEX "vybe_accommodation_hold_nights_allocation_idx"
  ON "vybe_accommodation_hold_nights" ("allocation_night_id");
CREATE INDEX "vybe_accommodation_hold_nights_hold_date_idx"
  ON "vybe_accommodation_hold_nights" ("hold_id", "stay_date");

-- Allocation-night rows must fall inside the allocation's half-open date range.
CREATE FUNCTION vybe_validate_accommodation_allocation_night()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  allocation_start DATE;
  allocation_end DATE;
BEGIN
  SELECT "start_date", "end_date"
    INTO allocation_start, allocation_end
    FROM "vybe_accommodation_allocations"
   WHERE "id" = NEW."allocation_id"
     AND "room_category_id" = NEW."room_category_id";
  IF NOT FOUND OR NEW."stay_date" < allocation_start OR NEW."stay_date" >= allocation_end THEN
    RAISE EXCEPTION 'allocation night must be within the allocation date range'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "vybe_accommodation_allocation_night_range_guard"
BEFORE INSERT OR UPDATE OF "allocation_id", "room_category_id", "stay_date"
ON "vybe_accommodation_allocation_nights"
FOR EACH ROW
EXECUTE FUNCTION vybe_validate_accommodation_allocation_night();

-- Every hold line must belong to a consumed local night of its hold.
CREATE FUNCTION vybe_validate_accommodation_hold_night()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  check_in DATE;
  check_out DATE;
  hold_expiry TIMESTAMPTZ(6);
  hold_status "vybe_accommodation_hold_status";
  allocation_cutoff TIMESTAMPTZ(6);
  allocation_cutoff_local VARCHAR(40);
  allocation_cutoff_timezone VARCHAR(80);
  allocation_status "vybe_accommodation_allocation_status";
BEGIN
  SELECT "check_in_date", "check_out_date", "expires_at", "status"
    INTO check_in, check_out, hold_expiry, hold_status
    FROM "vybe_accommodation_holds"
   WHERE "id" = NEW."hold_id"
     AND "room_category_id" = NEW."room_category_id";
  IF NOT FOUND OR hold_status <> 'ACTIVE' OR hold_expiry <= CURRENT_TIMESTAMP
     OR NEW."stay_date" < check_in OR NEW."stay_date" >= check_out THEN
    RAISE EXCEPTION 'hold night must be inside the hold stay interval'
      USING ERRCODE = '23514';
  END IF;

  SELECT allocation."release_cutoff_at",
         allocation."release_cutoff_local",
         allocation."release_cutoff_timezone",
         allocation."status"
    INTO allocation_cutoff, allocation_cutoff_local,
         allocation_cutoff_timezone, allocation_status
    FROM "vybe_accommodation_allocation_nights" allocation_night
    JOIN "vybe_accommodation_allocations" allocation
      ON allocation."id" = allocation_night."allocation_id"
     AND allocation."room_category_id" = allocation_night."room_category_id"
   WHERE allocation_night."id" = NEW."allocation_night_id"
     AND allocation_night."room_category_id" = NEW."room_category_id"
     AND allocation_night."stay_date" = NEW."stay_date";
  IF NOT FOUND OR allocation_status <> 'ACTIVE'
     OR CURRENT_TIMESTAMP >= allocation_cutoff
     OR hold_expiry > allocation_cutoff
     OR NEW."release_cutoff_at_snapshot" <> allocation_cutoff
     OR NEW."release_cutoff_local_snapshot" <> allocation_cutoff_local
     OR NEW."release_cutoff_timezone_snapshot" <> allocation_cutoff_timezone THEN
    RAISE EXCEPTION 'hold line must use an active, unexpired allocation and its exact cutoff snapshot'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "vybe_accommodation_hold_night_snapshot_guard"
BEFORE INSERT OR UPDATE OF "hold_id", "allocation_night_id", "room_category_id",
  "stay_date", "quantity", "release_cutoff_at_snapshot",
  "release_cutoff_local_snapshot", "release_cutoff_timezone_snapshot"
ON "vybe_accommodation_hold_nights"
FOR EACH ROW
EXECUTE FUNCTION vybe_validate_accommodation_hold_night();

-- Serialize per-category/per-night capacity checks on the lock-anchor row.
-- The application still locks all requested nights in ascending date order;
-- this trigger is a final database guard against bypassing that invariant.
CREATE FUNCTION vybe_guard_accommodation_hold_capacity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  category_id UUID;
  night_date DATE;
  allocated INTEGER;
  committed INTEGER;
  active_held BIGINT;
BEGIN
  SELECT "room_category_id", "stay_date"
    INTO category_id, night_date
    FROM "vybe_accommodation_allocation_nights"
   WHERE "id" = NEW."allocation_night_id";

  PERFORM 1
    FROM "vybe_accommodation_night_locks"
   WHERE "room_category_id" = category_id
     AND "stay_date" = night_date
   FOR UPDATE;

  SELECT "allocated_quantity", "committed_quantity"
    INTO allocated, committed
    FROM "vybe_accommodation_allocation_nights"
   WHERE "id" = NEW."allocation_night_id"
   FOR UPDATE;

  SELECT COALESCE(SUM("quantity"), 0)
    INTO active_held
    FROM "vybe_accommodation_hold_nights" detail
    JOIN "vybe_accommodation_holds" hold ON hold."id" = detail."hold_id"
   WHERE detail."allocation_night_id" = NEW."allocation_night_id"
     AND hold."status" = 'ACTIVE';

  IF committed + active_held + NEW."quantity" > allocated THEN
    RAISE EXCEPTION 'accommodation allocation-night capacity exceeded'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "vybe_accommodation_hold_capacity_guard"
BEFORE INSERT
ON "vybe_accommodation_hold_nights"
FOR EACH ROW
EXECUTE FUNCTION vybe_guard_accommodation_hold_capacity();

-- A provider may reclaim only unheld/uncommitted quantity, and only at or
-- after the provider-agreed cutoff for that allocation.
CREATE FUNCTION vybe_guard_accommodation_allocation_reduction()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  cutoff TIMESTAMPTZ(6);
  active_held BIGINT;
BEGIN
  IF NEW."allocated_quantity" < OLD."allocated_quantity" THEN
    SELECT allocation."release_cutoff_at"
      INTO cutoff
      FROM "vybe_accommodation_allocations" allocation
     WHERE allocation."id" = NEW."allocation_id"
       AND allocation."room_category_id" = NEW."room_category_id";

    IF CURRENT_TIMESTAMP < cutoff THEN
      RAISE EXCEPTION 'accommodation allocation cannot be reclaimed before its agreed cutoff'
        USING ERRCODE = '23514';
    END IF;

    SELECT COALESCE(SUM(detail."quantity"), 0)
      INTO active_held
      FROM "vybe_accommodation_hold_nights" detail
      JOIN "vybe_accommodation_holds" hold ON hold."id" = detail."hold_id"
     WHERE detail."allocation_night_id" = NEW."id"
       AND hold."status" = 'ACTIVE';

    IF NEW."allocated_quantity" < NEW."committed_quantity" + active_held THEN
      RAISE EXCEPTION 'allocation reduction would consume held or committed accommodation inventory'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "vybe_accommodation_allocation_reduction_guard"
BEFORE UPDATE OF "allocated_quantity"
ON "vybe_accommodation_allocation_nights"
FOR EACH ROW
EXECUTE FUNCTION vybe_guard_accommodation_allocation_reduction();

-- Allocation adjustments are immutable audit history.
CREATE FUNCTION vybe_prevent_accommodation_adjustment_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'accommodation allocation adjustments are append-only'
    USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER "vybe_accommodation_adjustments_append_only"
BEFORE UPDATE OR DELETE
ON "vybe_accommodation_allocation_adjustments"
FOR EACH ROW
EXECUTE FUNCTION vybe_prevent_accommodation_adjustment_mutation();
