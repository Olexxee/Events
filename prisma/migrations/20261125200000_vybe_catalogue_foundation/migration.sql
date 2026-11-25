CREATE TYPE "vybe_offering_status" AS ENUM ('DRAFT', 'PUBLISHED', 'PAUSED', 'ARCHIVED');
CREATE TYPE "vybe_offering_version_status" AS ENUM ('DRAFT', 'PUBLISHED');

CREATE TABLE "vybe_offerings" (
  "id" UUID NOT NULL,
  "provider_profile_id" UUID NOT NULL,
  "category" "vybe_category" NOT NULL,
  "status" "vybe_offering_status" NOT NULL DEFAULT 'DRAFT',
  "current_published_version" INTEGER,
  "created_by_user_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "vybe_offerings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "vybe_offering_versions" (
  "id" UUID NOT NULL,
  "offering_id" UUID NOT NULL,
  "version" INTEGER NOT NULL,
  "status" "vybe_offering_version_status" NOT NULL DEFAULT 'DRAFT',
  "content" JSONB NOT NULL,
  "created_by_user_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "published_at" TIMESTAMPTZ(6),
  CONSTRAINT "vybe_offering_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "vybe_offering_versions_version_check" CHECK ("version" > 0)
);

CREATE TABLE "vybe_category_activations" (
  "id" UUID NOT NULL,
  "category" "vybe_category" NOT NULL,
  "is_active" BOOLEAN NOT NULL DEFAULT false,
  "checklist" JSONB NOT NULL DEFAULT '[]',
  "reason" TEXT,
  "activated_by_user_id" UUID,
  "activated_at" TIMESTAMPTZ(6),
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "vybe_category_activations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "vybe_offering_versions_offering_version_key" ON "vybe_offering_versions"("offering_id", "version");
CREATE INDEX "vybe_offerings_provider_category_status_idx" ON "vybe_offerings"("provider_profile_id", "category", "status");
CREATE INDEX "vybe_offerings_category_status_created_idx" ON "vybe_offerings"("category", "status", "created_at");
CREATE INDEX "vybe_offering_versions_offering_status_version_idx" ON "vybe_offering_versions"("offering_id", "status", "version");
CREATE UNIQUE INDEX "vybe_category_activations_category_key" ON "vybe_category_activations"("category");

ALTER TABLE "vybe_offerings"
  ADD CONSTRAINT "vybe_offerings_provider_profile_id_fkey"
  FOREIGN KEY ("provider_profile_id") REFERENCES "vybe_provider_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "vybe_offerings_created_by_user_id_fkey"
  FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "vybe_offering_versions"
  ADD CONSTRAINT "vybe_offering_versions_offering_id_fkey"
  FOREIGN KEY ("offering_id") REFERENCES "vybe_offerings"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "vybe_offering_versions_created_by_user_id_fkey"
  FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "vybe_category_activations"
  ADD CONSTRAINT "vybe_category_activations_activated_by_user_id_fkey"
  FOREIGN KEY ("activated_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
