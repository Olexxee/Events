-- VYBE-017: make accommodation holds complete, immutable snapshots.
CREATE FUNCTION vybe_validate_accommodation_hold_completeness()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_hold_id UUID;
  hold_record RECORD;
BEGIN
  IF TG_TABLE_NAME = 'vybe_accommodation_holds' THEN
    target_hold_id := NEW."id";
  ELSE
    target_hold_id := NEW."hold_id";
  END IF;

  SELECT "id", "check_in_date", "check_out_date", "room_quantity"
    INTO hold_record
    FROM "vybe_accommodation_holds"
   WHERE "id" = target_hold_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF EXISTS (
    SELECT 1
      FROM generate_series(
        hold_record."check_in_date"::timestamp,
        (hold_record."check_out_date" - 1)::timestamp,
        INTERVAL '1 day'
      ) AS stay("stay_at")
      LEFT JOIN (
        SELECT "stay_date", SUM("quantity") AS "held_quantity"
          FROM "vybe_accommodation_hold_nights"
         WHERE "hold_id" = target_hold_id
         GROUP BY "stay_date"
      ) detail
        ON detail."stay_date" = stay."stay_at"::date
     WHERE COALESCE(detail."held_quantity", 0) <> hold_record."room_quantity"
  ) THEN
    RAISE EXCEPTION 'accommodation hold must reserve its exact room quantity for every local stay night'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM "vybe_accommodation_hold_nights"
     WHERE "hold_id" = target_hold_id
       AND (
         "stay_date" < hold_record."check_in_date"
         OR "stay_date" >= hold_record."check_out_date"
       )
  ) THEN
    RAISE EXCEPTION 'accommodation hold contains a room night outside its stay date range'
      USING ERRCODE = '23514';
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "vybe_accommodation_hold_complete_after_create"
AFTER INSERT
ON "vybe_accommodation_holds"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION vybe_validate_accommodation_hold_completeness();

CREATE CONSTRAINT TRIGGER "vybe_accommodation_hold_nights_complete_after_insert"
AFTER INSERT
ON "vybe_accommodation_hold_nights"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION vybe_validate_accommodation_hold_completeness();

CREATE FUNCTION vybe_guard_accommodation_hold_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'accommodation holds are retained as immutable audit records'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."room_category_id" IS DISTINCT FROM OLD."room_category_id"
     OR NEW."user_id" IS DISTINCT FROM OLD."user_id"
     OR NEW."idempotency_key" IS DISTINCT FROM OLD."idempotency_key"
     OR NEW."request_hash" IS DISTINCT FROM OLD."request_hash"
     OR NEW."check_in_date" IS DISTINCT FROM OLD."check_in_date"
     OR NEW."check_out_date" IS DISTINCT FROM OLD."check_out_date"
     OR NEW."room_quantity" IS DISTINCT FROM OLD."room_quantity"
     OR NEW."snapshot" IS DISTINCT FROM OLD."snapshot" THEN
    RAISE EXCEPTION 'accommodation hold request and snapshot fields are immutable'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."expires_at" > OLD."expires_at" THEN
    RAISE EXCEPTION 'accommodation hold expiry may be shortened but never extended'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."status" IS DISTINCT FROM OLD."status" THEN
    IF OLD."status" <> 'ACTIVE' THEN
      RAISE EXCEPTION 'terminal accommodation holds cannot change state'
        USING ERRCODE = '23514';
    END IF;
    IF NEW."status" = 'EXPIRED' AND NEW."expires_at" > CURRENT_TIMESTAMP THEN
      RAISE EXCEPTION 'an accommodation hold cannot expire before its expiry timestamp'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "vybe_accommodation_hold_immutable_snapshot_guard"
BEFORE UPDATE OR DELETE
ON "vybe_accommodation_holds"
FOR EACH ROW
EXECUTE FUNCTION vybe_guard_accommodation_hold_mutation();

CREATE FUNCTION vybe_prevent_accommodation_hold_night_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'accommodation hold-night allocation snapshots are append-only'
    USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER "vybe_accommodation_hold_nights_append_only"
BEFORE UPDATE OR DELETE
ON "vybe_accommodation_hold_nights"
FOR EACH ROW
EXECUTE FUNCTION vybe_prevent_accommodation_hold_night_mutation();
