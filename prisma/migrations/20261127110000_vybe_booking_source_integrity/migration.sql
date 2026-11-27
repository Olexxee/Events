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
  source_service_start TIMESTAMPTZ;
  source_service_end TIMESTAMPTZ;
  source_blocked_start TIMESTAMPTZ;
  source_blocked_end TIMESTAMPTZ;
  source_timezone VARCHAR(80);
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
           hold."capacity_quantity", occurrence."offering_version",
           hold."service_starts_at", hold."service_ends_at",
           hold."blocked_starts_at", hold."blocked_ends_at", occurrence."timezone"
      INTO source_user, source_offering, source_resource, source_mode,
           source_status, source_quantity, source_version,
           source_service_start, source_service_end,
           source_blocked_start, source_blocked_end, source_timezone
      FROM "vybe_time_slot_holds" hold
      JOIN "vybe_time_slot_occurrences" occurrence ON occurrence."id" = hold."occurrence_id"
     WHERE hold."id" = NEW."time_slot_hold_id";
  END IF;

  IF source_user IS NULL OR source_user <> NEW."customer_user_id"
     OR source_offering <> NEW."offering_id"
     OR source_status <> 'CONVERTED'
     OR source_version IS DISTINCT FROM NEW."offering_version" THEN
    RAISE EXCEPTION 'booking source hold owner, offering, version or conversion state does not match' USING ERRCODE = '23514';
  END IF;

  IF NEW."source_type" = 'QUANTITY_POOL' AND NEW."quantity" <> source_quantity THEN
    RAISE EXCEPTION 'quantity-pool booking quantity must equal the converted hold' USING ERRCODE = '23514';
  END IF;

  IF NEW."source_type" = 'CAPACITY_SESSION' AND (
       source_mode IS DISTINCT FROM 'CAPACITY'
       OR NEW."quantity" IS NULL
       OR NEW."quantity" <> source_quantity
       OR NEW."service_starts_at" IS DISTINCT FROM source_service_start
       OR NEW."service_ends_at" IS DISTINCT FROM source_service_end
       OR NEW."blocked_starts_at" IS DISTINCT FROM source_blocked_start
       OR NEW."blocked_ends_at" IS DISTINCT FROM source_blocked_end
       OR NEW."timezone" IS DISTINCT FROM source_timezone
     ) THEN
    RAISE EXCEPTION 'capacity booking must exactly match its converted capacity hold' USING ERRCODE = '23514';
  END IF;

  IF NEW."source_type" = 'EXCLUSIVE_RESOURCE' AND (
       source_mode IS DISTINCT FROM 'EXCLUSIVE'
       OR source_resource IS DISTINCT FROM NEW."resource_id"
       OR NEW."service_starts_at" IS DISTINCT FROM source_service_start
       OR NEW."service_ends_at" IS DISTINCT FROM source_service_end
       OR NEW."blocked_starts_at" IS DISTINCT FROM source_blocked_start
       OR NEW."blocked_ends_at" IS DISTINCT FROM source_blocked_end
       OR NEW."timezone" IS DISTINCT FROM source_timezone
     ) THEN
    RAISE EXCEPTION 'exclusive booking must exactly match its converted resource hold' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION vybe_reject_booking_snapshot_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."public_reference" IS DISTINCT FROM OLD."public_reference"
     OR NEW."customer_user_id" IS DISTINCT FROM OLD."customer_user_id"
     OR NEW."provider_profile_id" IS DISTINCT FROM OLD."provider_profile_id"
     OR NEW."provider_organization_id" IS DISTINCT FROM OLD."provider_organization_id"
     OR NEW."offering_id" IS DISTINCT FROM OLD."offering_id"
     OR NEW."offering_version" IS DISTINCT FROM OLD."offering_version"
     OR NEW."source_type" IS DISTINCT FROM OLD."source_type"
     OR NEW."inventory_hold_id" IS DISTINCT FROM OLD."inventory_hold_id"
     OR NEW."time_slot_hold_id" IS DISTINCT FROM OLD."time_slot_hold_id"
     OR NEW."service_starts_at" IS DISTINCT FROM OLD."service_starts_at"
     OR NEW."service_ends_at" IS DISTINCT FROM OLD."service_ends_at"
     OR NEW."blocked_starts_at" IS DISTINCT FROM OLD."blocked_starts_at"
     OR NEW."blocked_ends_at" IS DISTINCT FROM OLD."blocked_ends_at"
     OR NEW."timezone" IS DISTINCT FROM OLD."timezone"
     OR NEW."quantity" IS DISTINCT FROM OLD."quantity"
     OR NEW."resource_id" IS DISTINCT FROM OLD."resource_id"
     OR NEW."offering_snapshot" IS DISTINCT FROM OLD."offering_snapshot"
     OR NEW."price_quote_snapshot" IS DISTINCT FROM OLD."price_quote_snapshot"
     OR NEW."accepted_terms_snapshot" IS DISTINCT FROM OLD."accepted_terms_snapshot"
     OR NEW."external_order_item_reference" IS DISTINCT FROM OLD."external_order_item_reference"
     OR NEW."confirmed_at" IS DISTINCT FROM OLD."confirmed_at"
     OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
    RAISE EXCEPTION 'Vybe booking source and accepted snapshots are immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "vybe_bookings_snapshot_immutable"
BEFORE UPDATE ON "vybe_bookings"
FOR EACH ROW EXECUTE FUNCTION vybe_reject_booking_snapshot_mutation();


-- Keep the occupancy exclusion domain correct even while older application
-- instances still transition source holds without explicitly updating occupancy.
CREATE OR REPLACE FUNCTION vybe_sync_exclusive_occupancy_terminal_hold()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD."status" = 'ACTIVE' AND NEW."status" IN ('RELEASED', 'EXPIRED') THEN
    UPDATE "vybe_time_slot_resource_occupancies"
       SET "status" = CASE NEW."status"::text
         WHEN 'RELEASED' THEN 'RELEASED'::"vybe_time_slot_resource_occupancy_status"
         ELSE 'EXPIRED'::"vybe_time_slot_resource_occupancy_status"
       END,
           "updated_at" = CURRENT_TIMESTAMP
     WHERE "source_hold_id" = NEW."id"
       AND "status" = 'HELD';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "vybe_time_slot_hold_terminal_occupancy_sync"
AFTER UPDATE OF "status" ON "vybe_time_slot_holds"
FOR EACH ROW EXECUTE FUNCTION vybe_sync_exclusive_occupancy_terminal_hold();
