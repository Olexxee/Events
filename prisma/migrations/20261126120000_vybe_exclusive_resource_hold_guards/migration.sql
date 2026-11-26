-- A provider cannot deactivate a concrete resource while an active hold
-- still relies on it. Expired rows are transitioned synchronously by the next
-- hold attempt; until then they remain conservatively protected.
CREATE OR REPLACE FUNCTION vybe_prevent_time_slot_resource_deactivation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD."is_active" = true AND NEW."is_active" = false AND EXISTS (
    SELECT 1
      FROM "vybe_time_slot_holds" hold
     WHERE hold."resource_id" = OLD."id"
       AND hold."status" = 'ACTIVE'
  ) THEN
    RAISE EXCEPTION 'cannot deactivate a resource while active time-slot holds depend on it'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "vybe_time_slot_resource_active_hold_guard"
BEFORE UPDATE OF "is_active"
ON "vybe_time_slot_resources"
FOR EACH ROW
EXECUTE FUNCTION vybe_prevent_time_slot_resource_deactivation();

-- Deactivating a resource group is also prohibited while an active hold
-- depends on an occurrence backed by that group.
CREATE OR REPLACE FUNCTION vybe_prevent_time_slot_group_deactivation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD."is_active" = true AND NEW."is_active" = false AND EXISTS (
    SELECT 1
      FROM "vybe_time_slot_occurrences" occurrence
      JOIN "vybe_time_slot_holds" hold
        ON hold."occurrence_id" = occurrence."id"
     WHERE occurrence."resource_group_id" = OLD."id"
       AND hold."status" = 'ACTIVE'
       AND hold."resource_id" IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'cannot deactivate a resource group while active time-slot holds depend on it'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "vybe_time_slot_resource_group_active_hold_guard"
BEFORE UPDATE OF "is_active"
ON "vybe_time_slot_resource_groups"
FOR EACH ROW
EXECUTE FUNCTION vybe_prevent_time_slot_group_deactivation();
