-- VYBE-015: aggregate room-category physical capacity across allocation lots.
-- Nullable during rollout so existing categories can be backfilled from provider evidence.
-- Allocation-night writes are blocked until a positive count is recorded.
ALTER TABLE "vybe_accommodation_room_categories"
  ADD COLUMN "physical_unit_count" INTEGER;

ALTER TABLE "vybe_accommodation_room_categories"
  ADD CONSTRAINT "vybe_accommodation_room_categories_physical_unit_count_check"
  CHECK ("physical_unit_count" IS NULL OR "physical_unit_count" > 0);

-- Serialize every aggregate allocation change on the same category/night anchor
-- already used by accommodation holds.
CREATE FUNCTION vybe_guard_accommodation_aggregate_allocation_capacity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  physical_count INTEGER;
  existing_total BIGINT;
  category_id UUID;
  night_date DATE;
BEGIN
  category_id := NEW."room_category_id";
  night_date := NEW."stay_date";

  SELECT "physical_unit_count"
    INTO physical_count
    FROM "vybe_accommodation_room_categories"
   WHERE "id" = category_id
   FOR UPDATE;

  PERFORM 1
    FROM "vybe_accommodation_night_locks"
   WHERE "room_category_id" = category_id
     AND "stay_date" = night_date
   FOR UPDATE;

  IF physical_count IS NULL OR physical_count <= 0 THEN
    RAISE EXCEPTION 'room category requires a positive, provider-evidenced physical unit count before allocation'
      USING ERRCODE = '23514';
  END IF;

  SELECT COALESCE(SUM(night."allocated_quantity"), 0)
    INTO existing_total
    FROM "vybe_accommodation_allocation_nights" night
    JOIN "vybe_accommodation_allocations" allocation
      ON allocation."id" = night."allocation_id"
     AND allocation."room_category_id" = night."room_category_id"
   WHERE night."room_category_id" = category_id
     AND night."stay_date" = night_date
     AND allocation."status" IN ('ACTIVE', 'PAUSED')
     AND (TG_OP = 'INSERT' OR night."id" <> NEW."id");

  IF EXISTS (
    SELECT 1
      FROM "vybe_accommodation_allocations" allocation
     WHERE allocation."id" = NEW."allocation_id"
       AND allocation."status" IN ('ACTIVE', 'PAUSED')
  ) THEN
    existing_total := existing_total + NEW."allocated_quantity";
  END IF;

  IF existing_total > physical_count THEN
    RAISE EXCEPTION 'aggregate accommodation allocations exceed physical room-category capacity'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "vybe_accommodation_aggregate_allocation_capacity_guard"
BEFORE INSERT OR UPDATE OF "allocation_id", "room_category_id", "stay_date", "allocated_quantity"
ON "vybe_accommodation_allocation_nights"
FOR EACH ROW
EXECUTE FUNCTION vybe_guard_accommodation_aggregate_allocation_capacity();

-- Physical capacity cannot be reduced below any already allocated category/night total.
CREATE FUNCTION vybe_guard_accommodation_physical_capacity_update()
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
        SELECT 1 FROM "vybe_accommodation_allocation_nights" night
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
BEFORE UPDATE OF "physical_unit_count"
ON "vybe_accommodation_room_categories"
FOR EACH ROW
EXECUTE FUNCTION vybe_guard_accommodation_physical_capacity_update();


-- Reactivating a paused allocation must also fit under the physical ceiling.
CREATE FUNCTION vybe_guard_accommodation_allocation_status_capacity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  night_record RECORD;
  physical_count INTEGER;
  allocated_total BIGINT;
BEGIN
  IF NEW."status" IS DISTINCT FROM OLD."status"
     AND NEW."status" IN ('ACTIVE', 'PAUSED') THEN
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
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "vybe_accommodation_allocation_status_capacity_guard"
BEFORE UPDATE OF "status"
ON "vybe_accommodation_allocations"
FOR EACH ROW
EXECUTE FUNCTION vybe_guard_accommodation_allocation_status_capacity();
