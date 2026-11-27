ALTER TABLE "vybe_inventory_holds"
  ADD COLUMN "offering_version" INTEGER;

UPDATE "vybe_inventory_holds" hold
   SET "offering_version" = COALESCE(
     offering."current_published_version",
     latest."version"
   )
  FROM "vybe_inventory_pools" pool
  JOIN "vybe_offerings" offering ON offering."id" = pool."offering_id"
  LEFT JOIN LATERAL (
    SELECT version."version"
      FROM "vybe_offering_versions" version
     WHERE version."offering_id" = offering."id"
       AND version."status" = 'PUBLISHED'
     ORDER BY version."version" DESC
     LIMIT 1
  ) latest ON true
 WHERE hold."pool_id" = pool."id";

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "vybe_inventory_holds" WHERE "offering_version" IS NULL OR "offering_version" <= 0) THEN
    RAISE EXCEPTION 'Cannot backfill a valid offering version for every existing Vybe inventory hold';
  END IF;
END;
$$;

ALTER TABLE "vybe_inventory_holds"
  ALTER COLUMN "offering_version" SET NOT NULL,
  ADD CONSTRAINT "vybe_inventory_holds_offering_version_positive_check" CHECK ("offering_version" > 0);

ALTER TABLE "vybe_bookings"
  ALTER COLUMN "service_starts_at" DROP NOT NULL,
  ALTER COLUMN "service_ends_at" DROP NOT NULL,
  ALTER COLUMN "blocked_starts_at" DROP NOT NULL,
  ALTER COLUMN "blocked_ends_at" DROP NOT NULL,
  ALTER COLUMN "timezone" DROP NOT NULL;

ALTER TABLE "vybe_bookings"
  DROP CONSTRAINT "vybe_bookings_service_interval_check",
  DROP CONSTRAINT "vybe_bookings_blocked_interval_check",
  ADD CONSTRAINT "vybe_bookings_schedule_shape_check" CHECK (
    (
      "source_type" = 'QUANTITY_POOL'
      AND "service_starts_at" IS NULL
      AND "service_ends_at" IS NULL
      AND "blocked_starts_at" IS NULL
      AND "blocked_ends_at" IS NULL
      AND "timezone" IS NULL
    )
    OR
    (
      "source_type" IN ('CAPACITY_SESSION', 'EXCLUSIVE_RESOURCE')
      AND "service_starts_at" IS NOT NULL
      AND "service_ends_at" IS NOT NULL
      AND "blocked_starts_at" IS NOT NULL
      AND "blocked_ends_at" IS NOT NULL
      AND "timezone" IS NOT NULL
      AND "service_starts_at" < "service_ends_at"
      AND "blocked_starts_at" < "blocked_ends_at"
      AND "blocked_starts_at" <= "service_starts_at"
      AND "blocked_ends_at" >= "service_ends_at"
    )
  );

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
  source_status TEXT;
  source_quantity INTEGER;
  source_version INTEGER;
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
    SELECT hold."user_id", pool."offering_id", hold."status"::text,
           hold."quantity", hold."offering_version"
      INTO source_user, source_offering, source_status, source_quantity, source_version
      FROM "vybe_inventory_holds" hold
      JOIN "vybe_inventory_pools" pool ON pool."id" = hold."pool_id"
     WHERE hold."id" = NEW."inventory_hold_id";
  ELSE
    SELECT hold."user_id", occurrence."offering_id", hold."resource_id",
           occurrence."inventory_mode", hold."status"::text,
           hold."capacity_quantity", occurrence."offering_version"
      INTO source_user, source_offering, source_resource, source_mode,
           source_status, source_quantity, source_version
      FROM "vybe_time_slot_holds" hold
      JOIN "vybe_time_slot_occurrences" occurrence ON occurrence."id" = hold."occurrence_id"
     WHERE hold."id" = NEW."time_slot_hold_id";
  END IF;

  IF source_user IS NULL OR source_user <> NEW."customer_user_id"
     OR source_offering <> NEW."offering_id" OR source_status <> 'CONVERTED'
     OR source_version <> NEW."offering_version" THEN
    RAISE EXCEPTION 'booking source hold owner, offering, version or conversion state does not match' USING ERRCODE = '23514';
  END IF;

  IF NEW."source_type" = 'QUANTITY_POOL' AND NEW."quantity" <> source_quantity THEN
    RAISE EXCEPTION 'quantity-pool booking quantity must equal the converted hold' USING ERRCODE = '23514';
  END IF;

  IF NEW."source_type" = 'CAPACITY_SESSION' AND
     (source_mode <> 'CAPACITY' OR NEW."quantity" IS NULL OR NEW."quantity" <> source_quantity) THEN
    RAISE EXCEPTION 'capacity booking requires a matching converted capacity-session hold' USING ERRCODE = '23514';
  END IF;

  IF NEW."source_type" = 'EXCLUSIVE_RESOURCE' AND
     (source_mode <> 'EXCLUSIVE' OR source_resource IS DISTINCT FROM NEW."resource_id") THEN
    RAISE EXCEPTION 'exclusive booking requires the held resource' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;
