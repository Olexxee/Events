-- Enforce cross-record ownership and inventory-mode invariants at the database boundary.
-- These rules intentionally live in PostgreSQL because service-only checks cannot
-- protect against races, future code paths, or direct database writes.

CREATE OR REPLACE FUNCTION vybe_assert_time_slot_resource_group_owner()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  offering_provider_id UUID;
BEGIN
  SELECT "provider_profile_id"
    INTO offering_provider_id
    FROM "vybe_offerings"
   WHERE "id" = NEW."offering_id";

  IF offering_provider_id IS NULL OR offering_provider_id <> NEW."provider_profile_id" THEN
    RAISE EXCEPTION 'time-slot resource group provider must own its offering'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "vybe_time_slot_resource_groups_owner_guard"
BEFORE INSERT OR UPDATE OF "provider_profile_id", "offering_id"
ON "vybe_time_slot_resource_groups"
FOR EACH ROW
EXECUTE FUNCTION vybe_assert_time_slot_resource_group_owner();

CREATE OR REPLACE FUNCTION vybe_assert_time_slot_resource_owner()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  group_provider_id UUID;
BEGIN
  SELECT "provider_profile_id"
    INTO group_provider_id
    FROM "vybe_time_slot_resource_groups"
   WHERE "id" = NEW."resource_group_id";

  IF group_provider_id IS NULL OR NOT EXISTS (
    SELECT 1
      FROM "vybe_time_slot_resources" resource
     WHERE resource."id" = NEW."resource_id"
       AND resource."provider_profile_id" = group_provider_id
  ) THEN
    RAISE EXCEPTION 'time-slot group members must use resources owned by the group provider'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "vybe_time_slot_resource_group_members_owner_guard"
BEFORE INSERT OR UPDATE OF "resource_group_id", "resource_id"
ON "vybe_time_slot_resource_group_members"
FOR EACH ROW
EXECUTE FUNCTION vybe_assert_time_slot_resource_owner();

CREATE OR REPLACE FUNCTION vybe_assert_time_slot_occurrence_target()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  group_offering_id UUID;
BEGIN
  IF NEW."inventory_mode" = 'EXCLUSIVE' THEN
    SELECT "offering_id"
      INTO group_offering_id
      FROM "vybe_time_slot_resource_groups"
     WHERE "id" = NEW."resource_group_id";

    IF group_offering_id IS NULL OR group_offering_id <> NEW."offering_id" THEN
      RAISE EXCEPTION 'exclusive occurrence resource group must belong to the same offering'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "vybe_time_slot_occurrences_target_guard"
BEFORE INSERT OR UPDATE OF "offering_id", "inventory_mode", "resource_group_id"
ON "vybe_time_slot_occurrences"
FOR EACH ROW
EXECUTE FUNCTION vybe_assert_time_slot_occurrence_target();

CREATE OR REPLACE FUNCTION vybe_assert_time_slot_hold_target()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  occurrence_mode "vybe_time_slot_inventory_mode";
  occurrence_group_id UUID;
BEGIN
  SELECT "inventory_mode", "resource_group_id"
    INTO occurrence_mode, occurrence_group_id
    FROM "vybe_time_slot_occurrences"
   WHERE "id" = NEW."occurrence_id";

  IF occurrence_mode IS NULL THEN
    RAISE EXCEPTION 'time-slot hold occurrence does not exist'
      USING ERRCODE = '23503';
  END IF;

  IF occurrence_mode = 'CAPACITY' THEN
    IF NEW."capacity_quantity" IS NULL OR NEW."resource_id" IS NOT NULL THEN
      RAISE EXCEPTION 'capacity occurrences require quantity holds only'
        USING ERRCODE = '23514';
    END IF;
  ELSE
    IF NEW."capacity_quantity" IS NOT NULL OR NEW."resource_id" IS NULL THEN
      RAISE EXCEPTION 'exclusive occurrences require concrete resource holds only'
        USING ERRCODE = '23514';
    END IF;

    IF NOT EXISTS (
      SELECT 1
        FROM "vybe_time_slot_resource_group_members" member
       WHERE member."resource_group_id" = occurrence_group_id
         AND member."resource_id" = NEW."resource_id"
         AND (member."valid_from" IS NULL OR member."valid_from" <= NEW."blocked_starts_at")
         AND (member."valid_until" IS NULL OR member."valid_until" >= NEW."blocked_ends_at")
    ) THEN
      RAISE EXCEPTION 'exclusive hold resource must be a valid member of the occurrence resource group'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "vybe_time_slot_holds_target_guard"
BEFORE INSERT OR UPDATE OF "occurrence_id", "capacity_quantity", "resource_id", "blocked_starts_at", "blocked_ends_at"
ON "vybe_time_slot_holds"
FOR EACH ROW
EXECUTE FUNCTION vybe_assert_time_slot_hold_target();

-- A resource cannot be removed from, or have its membership window narrowed
-- across, an active hold. This keeps already-created holds backed by the same
-- provider-controlled resource until they are synchronously released/expired.
CREATE OR REPLACE FUNCTION vybe_protect_time_slot_active_membership()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_group_id UUID;
  target_resource_id UUID;
  target_valid_from TIMESTAMPTZ(6);
  target_valid_until TIMESTAMPTZ(6);
BEGIN
  IF TG_OP = 'DELETE' THEN
    target_group_id := OLD."resource_group_id";
    target_resource_id := OLD."resource_id";
    target_valid_from := NULL;
    target_valid_until := NULL;
  ELSE
    target_group_id := NEW."resource_group_id";
    target_resource_id := NEW."resource_id";
    target_valid_from := NEW."valid_from";
    target_valid_until := NEW."valid_until";
  END IF;

  IF EXISTS (
    SELECT 1
      FROM "vybe_time_slot_holds" hold
      JOIN "vybe_time_slot_occurrences" occurrence
        ON occurrence."id" = hold."occurrence_id"
     WHERE hold."resource_id" = target_resource_id
       AND occurrence."resource_group_id" = target_group_id
       AND hold."status" = 'ACTIVE'
       AND (
         TG_OP = 'DELETE'
         OR (target_valid_from IS NOT NULL AND target_valid_from > hold."blocked_starts_at")
         OR (target_valid_until IS NOT NULL AND target_valid_until < hold."blocked_ends_at")
         OR (target_valid_from IS NULL AND OLD."valid_from" IS NOT NULL)
         OR (target_valid_until IS NULL AND OLD."valid_until" IS NOT NULL)
       )
  ) THEN
    RAISE EXCEPTION 'cannot remove or narrow resource membership while active holds depend on it'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "vybe_time_slot_resource_group_members_active_hold_guard"
BEFORE UPDATE OR DELETE
ON "vybe_time_slot_resource_group_members"
FOR EACH ROW
EXECUTE FUNCTION vybe_protect_time_slot_active_membership();

-- Capacity rows and occurrences are created in one transaction. A deferred
-- constraint trigger validates the final transaction state, not intermediate
-- insert order: CAPACITY has exactly one row; EXCLUSIVE has none.
CREATE OR REPLACE FUNCTION vybe_assert_time_slot_capacity_mode()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_occurrence_id UUID;
  target_mode "vybe_time_slot_inventory_mode";
  capacity_count BIGINT;
BEGIN
  IF TG_TABLE_NAME = 'vybe_time_slot_occurrences' THEN
    target_occurrence_id := COALESCE(NEW."id", OLD."id");
  ELSE
    target_occurrence_id := COALESCE(NEW."occurrence_id", OLD."occurrence_id");
  END IF;

  SELECT "inventory_mode"
    INTO target_mode
    FROM "vybe_time_slot_occurrences"
   WHERE "id" = target_occurrence_id;

  IF target_mode IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT COUNT(*)
    INTO capacity_count
    FROM "vybe_time_slot_capacities"
   WHERE "occurrence_id" = target_occurrence_id;

  IF (target_mode = 'CAPACITY' AND capacity_count <> 1)
     OR (target_mode = 'EXCLUSIVE' AND capacity_count <> 0) THEN
    RAISE EXCEPTION 'time-slot capacity row must exist exactly for CAPACITY occurrences'
      USING ERRCODE = '23514';
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "vybe_time_slot_occurrences_capacity_mode_guard"
AFTER INSERT OR UPDATE OR DELETE
ON "vybe_time_slot_occurrences"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION vybe_assert_time_slot_capacity_mode();

CREATE CONSTRAINT TRIGGER "vybe_time_slot_capacities_capacity_mode_guard"
AFTER INSERT OR UPDATE OR DELETE
ON "vybe_time_slot_capacities"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION vybe_assert_time_slot_capacity_mode();
