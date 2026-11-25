CREATE TYPE "event_status" AS ENUM ('DRAFT', 'PUBLISHED', 'SALES_PAUSED', 'ONGOING', 'COMPLETED', 'POSTPONED', 'CANCELLED');
CREATE TYPE "event_format" AS ENUM ('IN_PERSON', 'ONLINE', 'HYBRID');
CREATE TYPE "event_visibility" AS ENUM ('PUBLIC', 'UNLISTED', 'INVITATION_ONLY');
CREATE TYPE "event_access_policy" AS ENUM ('OPEN', 'APPROVAL_REQUIRED', 'INVITATION_ONLY');
CREATE TYPE "event_experience_level" AS ENUM ('STANDARD', 'PREMIUM');
CREATE TYPE "event_moderation_status" AS ENUM ('CLEAR', 'UNDER_REVIEW', 'RESTRICTED', 'SUSPENDED', 'TAKEDOWN');

CREATE TABLE "event_categories" (
  "id" UUID NOT NULL,
  "slug" VARCHAR(80) NOT NULL,
  "name" VARCHAR(100) NOT NULL,
  "description" VARCHAR(500),
  "is_active" BOOLEAN NOT NULL DEFAULT TRUE,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "event_categories_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "event_categories_slug_key" ON "event_categories"("slug");
CREATE INDEX "event_categories_is_active_sort_order_idx" ON "event_categories"("is_active", "sort_order");

CREATE TABLE "events" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "category_id" UUID NOT NULL,
  "title" VARCHAR(180) NOT NULL,
  "slug" VARCHAR(200) NOT NULL,
  "summary" VARCHAR(500) NOT NULL,
  "description" TEXT NOT NULL,
  "format" "event_format" NOT NULL,
  "visibility" "event_visibility" NOT NULL DEFAULT 'PUBLIC',
  "access_policy" "event_access_policy" NOT NULL DEFAULT 'OPEN',
  "experience_level" "event_experience_level",
  "status" "event_status" NOT NULL DEFAULT 'DRAFT',
  "moderation_status" "event_moderation_status" NOT NULL DEFAULT 'CLEAR',
  "timezone" VARCHAR(80) NOT NULL,
  "published_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "events_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "event_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "events_organization_id_slug_key" ON "events"("organization_id", "slug");
CREATE INDEX "events_status_visibility_moderation_status_published_at_idx" ON "events"("status", "visibility", "moderation_status", "published_at");
CREATE INDEX "events_category_id_status_published_at_idx" ON "events"("category_id", "status", "published_at");
CREATE INDEX "events_organization_id_status_updated_at_idx" ON "events"("organization_id", "status", "updated_at");

CREATE TABLE "event_schedules" (
  "id" UUID NOT NULL,
  "event_id" UUID NOT NULL,
  "starts_at" TIMESTAMPTZ(6) NOT NULL,
  "ends_at" TIMESTAMPTZ(6) NOT NULL,
  "label" VARCHAR(120),
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "event_schedules_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "event_schedules_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "event_schedules_valid_range" CHECK ("ends_at" > "starts_at")
);
CREATE INDEX "event_schedules_event_id_starts_at_idx" ON "event_schedules"("event_id", "starts_at");

CREATE TABLE "event_venues" (
  "id" UUID NOT NULL,
  "event_id" UUID NOT NULL,
  "display_name" VARCHAR(160),
  "city" VARCHAR(100),
  "state" VARCHAR(100),
  "country" VARCHAR(100),
  "exact_address" VARCHAR(500),
  "access_instructions" TEXT,
  "private_url" VARCHAR(1000),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "event_venues_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "event_venues_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "event_venues_event_id_key" ON "event_venues"("event_id");

CREATE TABLE "event_revisions" (
  "id" UUID NOT NULL,
  "event_id" UUID NOT NULL,
  "revision_number" INTEGER NOT NULL,
  "actor_user_id" UUID NOT NULL,
  "change_type" VARCHAR(40) NOT NULL,
  "snapshot" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "event_revisions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "event_revisions_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "event_revisions_event_id_revision_number_key" ON "event_revisions"("event_id", "revision_number");
CREATE INDEX "event_revisions_event_id_created_at_idx" ON "event_revisions"("event_id", "created_at");

INSERT INTO "event_categories" ("id", "slug", "name", "description", "sort_order", "updated_at") VALUES
  (gen_random_uuid(), 'music', 'Music', 'Concerts, live music and performances', 10, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'nightlife', 'Nightlife', 'Parties, club events and nightlife experiences', 20, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'conference', 'Conference', 'Conferences, summits and professional gatherings', 30, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'workshop', 'Workshop', 'Practical workshops, classes and training', 40, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'sports', 'Sports', 'Sports competitions and recreational events', 50, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'community', 'Community', 'Community, social and cultural gatherings', 60, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'food', 'Food & Drink', 'Food festivals, tastings and dining events', 70, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'arts', 'Arts', 'Art, theatre, film and creative events', 80, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'education', 'Education', 'Educational events and learning programmes', 90, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'other', 'Other', 'Events outside the listed categories', 100, CURRENT_TIMESTAMP);
