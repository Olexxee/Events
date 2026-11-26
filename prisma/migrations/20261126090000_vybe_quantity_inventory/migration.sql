CREATE TYPE "vybe_inventory_pool_status" AS ENUM ('ACTIVE', 'PAUSED');
CREATE TYPE "vybe_inventory_hold_status" AS ENUM ('ACTIVE', 'RELEASED', 'EXPIRED');

CREATE TABLE "vybe_inventory_pools" (
  "id" UUID NOT NULL,
  "offering_id" UUID NOT NULL,
  "status" "vybe_inventory_pool_status" NOT NULL DEFAULT 'ACTIVE',
  "allocated_quantity" INTEGER NOT NULL DEFAULT 0,
  "committed_quantity" INTEGER NOT NULL DEFAULT 0,
  "hold_duration_seconds" INTEGER NOT NULL DEFAULT 600,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "vybe_inventory_pools_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "vybe_inventory_pools_allocated_nonnegative" CHECK ("allocated_quantity" >= 0),
  CONSTRAINT "vybe_inventory_pools_committed_valid" CHECK ("committed_quantity" >= 0 AND "committed_quantity" <= "allocated_quantity"),
  CONSTRAINT "vybe_inventory_pools_hold_duration_valid" CHECK ("hold_duration_seconds" BETWEEN 60 AND 1800)
);

CREATE TABLE "vybe_inventory_allocations" (
  "id" UUID NOT NULL,
  "pool_id" UUID NOT NULL,
  "actor_user_id" UUID NOT NULL,
  "quantity_delta" INTEGER NOT NULL,
  "reason" VARCHAR(1000) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "vybe_inventory_allocations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "vybe_inventory_allocations_nonzero_delta" CHECK ("quantity_delta" <> 0)
);

CREATE TABLE "vybe_inventory_holds" (
  "id" UUID NOT NULL,
  "pool_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "idempotency_key" VARCHAR(128) NOT NULL,
  "quantity" INTEGER NOT NULL,
  "status" "vybe_inventory_hold_status" NOT NULL DEFAULT 'ACTIVE',
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "vybe_inventory_holds_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "vybe_inventory_holds_quantity_positive" CHECK ("quantity" > 0)
);

CREATE UNIQUE INDEX "vybe_inventory_pools_offering_id_key" ON "vybe_inventory_pools"("offering_id");
CREATE INDEX "vybe_inventory_pools_status_updated_idx" ON "vybe_inventory_pools"("status", "updated_at");
CREATE INDEX "vybe_inventory_allocations_pool_created_idx" ON "vybe_inventory_allocations"("pool_id", "created_at");
CREATE INDEX "vybe_inventory_allocations_actor_created_idx" ON "vybe_inventory_allocations"("actor_user_id", "created_at");
CREATE UNIQUE INDEX "vybe_inventory_holds_user_idempotency_key" ON "vybe_inventory_holds"("user_id", "idempotency_key");
CREATE INDEX "vybe_inventory_holds_pool_status_expiry_idx" ON "vybe_inventory_holds"("pool_id", "status", "expires_at");
CREATE INDEX "vybe_inventory_holds_user_status_expiry_idx" ON "vybe_inventory_holds"("user_id", "status", "expires_at");

ALTER TABLE "vybe_inventory_pools"
  ADD CONSTRAINT "vybe_inventory_pools_offering_id_fkey"
  FOREIGN KEY ("offering_id") REFERENCES "vybe_offerings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "vybe_inventory_allocations"
  ADD CONSTRAINT "vybe_inventory_allocations_pool_id_fkey"
  FOREIGN KEY ("pool_id") REFERENCES "vybe_inventory_pools"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "vybe_inventory_allocations_actor_user_id_fkey"
  FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "vybe_inventory_holds"
  ADD CONSTRAINT "vybe_inventory_holds_pool_id_fkey"
  FOREIGN KEY ("pool_id") REFERENCES "vybe_inventory_pools"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "vybe_inventory_holds_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
