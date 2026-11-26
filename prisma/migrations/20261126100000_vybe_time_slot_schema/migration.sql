CREATE TYPE "vybe_time_slot_inventory_mode" AS ENUM ('CAPACITY', 'EXCLUSIVE');
CREATE TYPE "vybe_time_slot_occurrence_status" AS ENUM ('ACTIVE', 'PAUSED');
CREATE TYPE "vybe_time_slot_hold_status" AS ENUM ('ACTIVE', 'RELEASED', 'EXPIRED');

CREATE TABLE "vybe_time_slot_resource_groups" (
  "id" UUID NOT NULL,
  "provider_profile_id" UUID NOT NULL,
  "offering_id" UUID NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "valid_from" TIMESTAMPTZ(6),
  "valid_until" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "vybe_time_slot_resource_groups_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "vybe_time_slot_resource_groups_validity_check"
    CHECK ("valid_from" IS NULL OR "valid_until" IS NULL OR "valid_from" < "valid_until")
);

CREATE TABLE "vybe_time_slot_resources" (
  "id" UUID NOT NULL,
  "provider_profile_id" UUID NOT NULL,
  "provider_resource_key" VARCHAR(120) NOT NULL,
  "name" VARCHAR(160) NOT NULL,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "vybe_time_slot_resources_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "vybe_time_slot_occurrences" (
  "id" UUID NOT NULL,
  "offering_id" UUID NOT NULL,
  "offering_version" INTEGER NOT NULL,
  "inventory_mode" "vybe_time_slot_inventory_mode" NOT NULL,
  "timezone" VARCHAR(80) NOT NULL,
  "service_starts_at" TIMESTAMPTZ(6) NOT NULL,
  "service_ends_at" TIMESTAMPTZ(6) NOT NULL,
  "pre_buffer_seconds" INTEGER NOT NULL DEFAULT 0,
  "post_buffer_seconds" INTEGER NOT NULL DEFAULT 0,
  "blocked_starts_at" TIMESTAMPTZ(6) NOT NULL,
  "blocked_ends_at" TIMESTAMPTZ(6) NOT NULL,
  "status" "vybe_time_slot_occurrence_status" NOT NULL DEFAULT 'ACTIVE',
  "resource_group_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "vybe_time_slot_occurrences_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "vybe_time_slot_occurrences_service_interval_check"
    CHECK ("service_starts_at" < "service_ends_at"),
  CONSTRAINT "vybe_time_slot_occurrences_blocked_interval_check"
    CHECK (
      "blocked_starts_at" < "blocked_ends_at"
      AND "blocked_starts_at" <= "service_starts_at"
      AND "blocked_ends_at" >= "service_ends_at"
    ),
  CONSTRAINT "vybe_time_slot_occurrences_buffers_nonnegative_check"
    CHECK ("pre_buffer_seconds" >= 0 AND "post_buffer_seconds" >= 0),
  CONSTRAINT "vybe_time_slot_occurrences_inventory_target_check"
    CHECK (
      ("inventory_mode" = 'CAPACITY' AND "resource_group_id" IS NULL)
      OR ("inventory_mode" = 'EXCLUSIVE' AND "resource_group_id" IS NOT NULL)
    ),
  CONSTRAINT "vybe_time_slot_occurrences_offering_version_positive_check"
    CHECK ("offering_version" > 0)
);

CREATE TABLE "vybe_time_slot_capacities" (
  "id" UUID NOT NULL,
  "occurrence_id" UUID NOT NULL,
  "capacity" INTEGER NOT NULL,
  "committed_quantity" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "vybe_time_slot_capacities_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "vybe_time_slot_capacities_valid_quantity_check"
    CHECK ("capacity" >= 0 AND "committed_quantity" >= 0 AND "committed_quantity" <= "capacity")
);

CREATE TABLE "vybe_time_slot_resource_group_members" (
  "id" UUID NOT NULL,
  "resource_group_id" UUID NOT NULL,
  "resource_id" UUID NOT NULL,
  "valid_from" TIMESTAMPTZ(6),
  "valid_until" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "vybe_time_slot_resource_group_members_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "vybe_time_slot_resource_group_members_validity_check"
    CHECK ("valid_from" IS NULL OR "valid_until" IS NULL OR "valid_from" < "valid_until")
);

CREATE TABLE "vybe_time_slot_holds" (
  "id" UUID NOT NULL,
  "occurrence_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "idempotency_key" VARCHAR(128) NOT NULL,
  "capacity_quantity" INTEGER,
  "resource_id" UUID,
  "status" "vybe_time_slot_hold_status" NOT NULL DEFAULT 'ACTIVE',
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "service_starts_at" TIMESTAMPTZ(6) NOT NULL,
  "service_ends_at" TIMESTAMPTZ(6) NOT NULL,
  "blocked_starts_at" TIMESTAMPTZ(6) NOT NULL,
  "blocked_ends_at" TIMESTAMPTZ(6) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "vybe_time_slot_holds_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "vybe_time_slot_holds_target_check"
    CHECK (
      ("capacity_quantity" IS NOT NULL AND "capacity_quantity" > 0 AND "resource_id" IS NULL)
      OR ("capacity_quantity" IS NULL AND "resource_id" IS NOT NULL)
    ),
  CONSTRAINT "vybe_time_slot_holds_service_interval_check"
    CHECK ("service_starts_at" < "service_ends_at"),
  CONSTRAINT "vybe_time_slot_holds_blocked_interval_check"
    CHECK (
      "blocked_starts_at" < "blocked_ends_at"
      AND "blocked_starts_at" <= "service_starts_at"
      AND "blocked_ends_at" >= "service_ends_at"
    )
);

CREATE UNIQUE INDEX "vybe_time_slot_resource_groups_offering_name_key"
  ON "vybe_time_slot_resource_groups"("offering_id", "name");
CREATE INDEX "vybe_time_slot_resource_groups_provider_active_idx"
  ON "vybe_time_slot_resource_groups"("provider_profile_id", "is_active");
CREATE UNIQUE INDEX "vybe_time_slot_resources_provider_key"
  ON "vybe_time_slot_resources"("provider_profile_id", "provider_resource_key");
CREATE INDEX "vybe_time_slot_resources_provider_active_idx"
  ON "vybe_time_slot_resources"("provider_profile_id", "is_active");
CREATE INDEX "vybe_time_slot_occurrences_offering_status_start_idx"
  ON "vybe_time_slot_occurrences"("offering_id", "status", "service_starts_at");
CREATE INDEX "vybe_time_slot_occurrences_group_status_start_idx"
  ON "vybe_time_slot_occurrences"("resource_group_id", "status", "service_starts_at");
CREATE UNIQUE INDEX "vybe_time_slot_capacities_occurrence_id_key"
  ON "vybe_time_slot_capacities"("occurrence_id");
CREATE UNIQUE INDEX "vybe_time_slot_resource_group_members_group_resource_key"
  ON "vybe_time_slot_resource_group_members"("resource_group_id", "resource_id");
CREATE INDEX "vybe_time_slot_resource_group_members_resource_validity_idx"
  ON "vybe_time_slot_resource_group_members"("resource_id", "valid_from", "valid_until");
CREATE UNIQUE INDEX "vybe_time_slot_holds_user_idempotency_key"
  ON "vybe_time_slot_holds"("user_id", "idempotency_key");
CREATE INDEX "vybe_time_slot_holds_occurrence_status_expiry_idx"
  ON "vybe_time_slot_holds"("occurrence_id", "status", "expires_at");
CREATE INDEX "vybe_time_slot_holds_resource_status_start_idx"
  ON "vybe_time_slot_holds"("resource_id", "status", "blocked_starts_at");

ALTER TABLE "vybe_time_slot_resource_groups"
  ADD CONSTRAINT "vybe_time_slot_resource_groups_provider_profile_id_fkey"
  FOREIGN KEY ("provider_profile_id") REFERENCES "vybe_provider_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "vybe_time_slot_resource_groups_offering_id_fkey"
  FOREIGN KEY ("offering_id") REFERENCES "vybe_offerings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "vybe_time_slot_resources"
  ADD CONSTRAINT "vybe_time_slot_resources_provider_profile_id_fkey"
  FOREIGN KEY ("provider_profile_id") REFERENCES "vybe_provider_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "vybe_time_slot_occurrences"
  ADD CONSTRAINT "vybe_time_slot_occurrences_offering_id_fkey"
  FOREIGN KEY ("offering_id") REFERENCES "vybe_offerings"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "vybe_time_slot_occurrences_resource_group_id_fkey"
  FOREIGN KEY ("resource_group_id") REFERENCES "vybe_time_slot_resource_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "vybe_time_slot_capacities"
  ADD CONSTRAINT "vybe_time_slot_capacities_occurrence_id_fkey"
  FOREIGN KEY ("occurrence_id") REFERENCES "vybe_time_slot_occurrences"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "vybe_time_slot_resource_group_members"
  ADD CONSTRAINT "vybe_time_slot_resource_group_members_resource_group_id_fkey"
  FOREIGN KEY ("resource_group_id") REFERENCES "vybe_time_slot_resource_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "vybe_time_slot_resource_group_members_resource_id_fkey"
  FOREIGN KEY ("resource_id") REFERENCES "vybe_time_slot_resources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "vybe_time_slot_holds"
  ADD CONSTRAINT "vybe_time_slot_holds_occurrence_id_fkey"
  FOREIGN KEY ("occurrence_id") REFERENCES "vybe_time_slot_occurrences"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "vybe_time_slot_holds_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "vybe_time_slot_holds_resource_id_fkey"
  FOREIGN KEY ("resource_id") REFERENCES "vybe_time_slot_resources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- PostgreSQL must arbitrate exclusive-resource overlap; application read-before-write checks are insufficient.
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE "vybe_time_slot_holds"
  ADD CONSTRAINT "vybe_time_slot_holds_exclusive_resource_no_overlap"
  EXCLUDE USING gist (
    "resource_id" WITH =,
    tstzrange("blocked_starts_at", "blocked_ends_at", '[)') WITH &&
  )
  WHERE ("status" = 'ACTIVE' AND "resource_id" IS NOT NULL);
