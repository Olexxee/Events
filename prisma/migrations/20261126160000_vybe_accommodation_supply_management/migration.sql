-- VYBE-016: provider-managed accommodation supply and evidence-backed capacity.
ALTER TABLE "vybe_accommodation_room_categories"
  ADD COLUMN "physical_unit_count_evidence_reference" VARCHAR(1000);

ALTER TABLE "vybe_accommodation_room_categories"
  ADD CONSTRAINT "vybe_accommodation_room_categories_capacity_evidence_check"
  CHECK (
    "physical_unit_count" IS NULL
    OR (
      "physical_unit_count" > 0
      AND "physical_unit_count_evidence_reference" IS NOT NULL
      AND length(btrim("physical_unit_count_evidence_reference")) > 0
    )
  );

DROP TRIGGER "vybe_accommodation_physical_capacity_update_guard"
  ON "vybe_accommodation_room_categories";

CREATE OR REPLACE FUNCTION vybe_guard_accommodation_physical_capacity_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  overallocated_date DATE;
  allocated_total BIGINT;
BEGIN
  IF NEW."physical_unit_count" IS DISTINCT FROM OLD."physical_unit_count" THEN
    IF NEW."physical_unit_count" IS NULL OR NEW."physical_unit_count" <= 0 THEN
      IF EXISTS (
        SELECT 1
          FROM "vybe_accommodation_allocation_nights" night
          JOIN "vybe_accommodation_allocations" allocation
            ON allocation."id" = night."allocation_id"
           AND allocation."room_category_id" = night."room_category_id"
         WHERE night."room_category_id" = NEW."id"
           AND allocation."status" IN ('ACTIVE', 'PAUSED')
      ) THEN
        RAISE EXCEPTION 'physical room count cannot be cleared while accommodation allocations exist'
          USING ERRCODE = '23514';
      END IF;
    ELSE
      IF NEW."physical_unit_count_evidence_reference" IS NULL
         OR length(btrim(NEW."physical_unit_count_evidence_reference")) = 0
         OR NEW."physical_unit_count_evidence_reference"
              IS NOT DISTINCT FROM OLD."physical_unit_count_evidence_reference" THEN
        RAISE EXCEPTION 'changing physical room count requires a new evidence reference'
          USING ERRCODE = '23514';
      END IF;

      SELECT night."stay_date", SUM(night."allocated_quantity")
        INTO overallocated_date, allocated_total
        FROM "vybe_accommodation_allocation_nights" night
        JOIN "vybe_accommodation_allocations" allocation
          ON allocation."id" = night."allocation_id"
         AND allocation."room_category_id" = night."room_category_id"
       WHERE night."room_category_id" = NEW."id"
         AND allocation."status" IN ('ACTIVE', 'PAUSED')
       GROUP BY night."stay_date"
      HAVING SUM(night."allocated_quantity") > NEW."physical_unit_count"
       ORDER BY night."stay_date"
       LIMIT 1;

      IF overallocated_date IS NOT NULL THEN
        RAISE EXCEPTION 'physical room count is below existing allocation total for stay date %', overallocated_date
          USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "vybe_accommodation_physical_capacity_update_guard"
BEFORE UPDATE OF "physical_unit_count", "physical_unit_count_evidence_reference"
ON "vybe_accommodation_room_categories"
FOR EACH ROW
EXECUTE FUNCTION vybe_guard_accommodation_physical_capacity_update();

-- Allocation release is a governed inventory transition, not row deletion.
-- Reactivation is also rechecked against the category's physical capacity.
CREATE OR REPLACE FUNCTION vybe_guard_accommodation_allocation_status_capacity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  night_record RECORD;
  physical_count INTEGER;
  allocated_total BIGINT;
  release_cutoff TIMESTAMPTZ(6);
  active_held BIGINT;
BEGIN
  IF NEW."status" IS DISTINCT FROM OLD."status" THEN
    IF NEW."status" IN ('ACTIVE', 'PAUSED') THEN
      SELECT "physical_unit_count"
        INTO physical_count
        FROM "vybe_accommodation_room_categories"
       WHERE "id" = NEW."room_category_id"
       FOR UPDATE;

      IF physical_count IS NULL OR physical_count <= 0 THEN
        RAISE EXCEPTION 'room category requires a positive physical unit count before activating allocations'
          USING ERRCODE = '23514';
      END IF;

      FOR night_record IN
        SELECT "stay_date"
          FROM "vybe_accommodation_allocation_nights"
         WHERE "allocation_id" = NEW."id"
           AND "room_category_id" = NEW."room_category_id"
         ORDER BY "stay_date"
      LOOP
        PERFORM 1
          FROM "vybe_accommodation_night_locks"
         WHERE "room_category_id" = NEW."room_category_id"
           AND "stay_date" = night_record."stay_date"
         FOR UPDATE;

        SELECT COALESCE(SUM(night."allocated_quantity"), 0)
          INTO allocated_total
          FROM "vybe_accommodation_allocation_nights" night
          JOIN "vybe_accommodation_allocations" allocation
            ON allocation."id" = night."allocation_id"
           AND allocation."room_category_id" = night."room_category_id"
         WHERE night."room_category_id" = NEW."room_category_id"
           AND night."stay_date" = night_record."stay_date"
           AND allocation."status" IN ('ACTIVE', 'PAUSED');

        IF OLD."status" NOT IN ('ACTIVE', 'PAUSED') THEN
          SELECT allocated_total + COALESCE(SUM(night."allocated_quantity"), 0)
            INTO allocated_total
            FROM "vybe_accommodation_allocation_nights" night
           WHERE night."allocation_id" = NEW."id"
             AND night."room_category_id" = NEW."room_category_id"
             AND night."stay_date" = night_record."stay_date";
        END IF;

        IF allocated_total > physical_count THEN
          RAISE EXCEPTION 'reactivated accommodation allocation exceeds physical room-category capacity'
            USING ERRCODE = '23514';
        END IF;
      END LOOP;
    ELSIF NEW."status" = 'RELEASED' THEN
      SELECT "release_cutoff_at"
        INTO release_cutoff
        FROM "vybe_accommodation_allocations"
       WHERE "id" = NEW."id"
         AND "room_category_id" = NEW."room_category_id";

      IF CURRENT_TIMESTAMP < release_cutoff THEN
        RAISE EXCEPTION 'accommodation allocation cannot be released before its provider-agreed cutoff'
          USING ERRCODE = '23514';
      END IF;

      FOR night_record IN
        SELECT "id", "stay_date", "committed_quantity"
          FROM "vybe_accommodation_allocation_nights"
         WHERE "allocation_id" = NEW."id"
           AND "room_category_id" = NEW."room_category_id"
         ORDER BY "stay_date"
      LOOP
        PERFORM 1
          FROM "vybe_accommodation_night_locks"
         WHERE "room_category_id" = NEW."room_category_id"
           AND "stay_date" = night_record."stay_date"
         FOR UPDATE;

        SELECT COALESCE(SUM(detail."quantity"), 0)
          INTO active_held
          FROM "vybe_accommodation_hold_nights" detail
          JOIN "vybe_accommodation_holds" hold
            ON hold."id" = detail."hold_id"
         WHERE detail."allocation_night_id" = night_record."id"
           AND hold."status" = 'ACTIVE';

        IF night_record."committed_quantity" > 0 OR active_held > 0 THEN
          RAISE EXCEPTION 'accommodation allocation cannot be released while nights have active holds or committed bookings'
            USING ERRCODE = '23514';
        END IF;
      END LOOP;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
