CREATE TYPE "vybe_booking_cancellation_decision" AS ENUM (
  'ACCEPTED',
  'REJECTED',
  'ALREADY_CANCELLED'
);

CREATE TABLE "vybe_booking_cancellations" (
  "id" UUID NOT NULL,
  "booking_id" UUID NOT NULL,
  "customer_user_id" UUID NOT NULL,
  "source_type" "vybe_booking_source_type" NOT NULL,
  "source_hold_id" UUID NOT NULL,
  "idempotency_key" VARCHAR(120) NOT NULL,
  "request_hash" CHAR(64) NOT NULL,
  "decision" "vybe_booking_cancellation_decision" NOT NULL,
  "decision_code" VARCHAR(80),
  "reason" VARCHAR(1000) NOT NULL,
  "policy_version" VARCHAR(80),
  "policy_snapshot" JSONB,
  "decided_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "vybe_booking_cancellations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "vybe_booking_cancellations_booking_fkey"
    FOREIGN KEY ("booking_id") REFERENCES "vybe_bookings"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "vybe_booking_cancellations_customer_fkey"
    FOREIGN KEY ("customer_user_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "vybe_booking_cancellations_decision_check" CHECK (
    ("decision" = 'ACCEPTED'
      AND "decision_code" IS NULL
      AND "policy_version" IS NOT NULL
      AND "policy_snapshot" IS NOT NULL
      AND jsonb_typeof("policy_snapshot") = 'object')
    OR ("decision" = 'REJECTED' AND "decision_code" IS NOT NULL)
    OR ("decision" = 'ALREADY_CANCELLED'
      AND "decision_code" = 'VYBE_BOOKING_ALREADY_CANCELLED')
  )
);

CREATE UNIQUE INDEX "vybe_booking_cancellations_customer_idempotency_key"
  ON "vybe_booking_cancellations"("customer_user_id", "idempotency_key");

CREATE INDEX "vybe_booking_cancellations_booking_decided_idx"
  ON "vybe_booking_cancellations"("booking_id", "decided_at");

CREATE UNIQUE INDEX "vybe_booking_cancellations_one_accepted_per_booking"
  ON "vybe_booking_cancellations"("booking_id")
  WHERE "decision" = 'ACCEPTED';

CREATE OR REPLACE FUNCTION vybe_validate_booking_cancellation_source()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  booking_customer UUID;
  booking_source_type "vybe_booking_source_type";
  booking_source_hold UUID;
  booking_status "vybe_booking_status";
BEGIN
  SELECT booking."customer_user_id",
         booking."source_type",
         COALESCE(booking."inventory_hold_id", booking."time_slot_hold_id"),
         booking."status"
    INTO booking_customer, booking_source_type, booking_source_hold, booking_status
    FROM "vybe_bookings" booking
   WHERE booking."id" = NEW."booking_id";

  IF booking_customer IS NULL
     OR booking_customer <> NEW."customer_user_id"
     OR booking_source_type <> NEW."source_type"
     OR booking_source_hold <> NEW."source_hold_id" THEN
    RAISE EXCEPTION 'cancellation must reference the booking customer and exact source hold'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."decision" = 'ACCEPTED' AND booking_status <> 'CANCELLED' THEN
    RAISE EXCEPTION 'accepted cancellation requires a cancelled booking'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "vybe_booking_cancellations_source_guard"
BEFORE INSERT ON "vybe_booking_cancellations"
FOR EACH ROW
EXECUTE FUNCTION vybe_validate_booking_cancellation_source();

CREATE OR REPLACE FUNCTION vybe_reject_booking_cancellation_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Vybe booking cancellation decisions are append-only'
    USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER "vybe_booking_cancellations_append_only"
BEFORE UPDATE OR DELETE ON "vybe_booking_cancellations"
FOR EACH ROW
EXECUTE FUNCTION vybe_reject_booking_cancellation_mutation();
