CREATE TYPE "organizer_application_status" AS ENUM (
  'SUBMITTED',
  'UNDER_REVIEW',
  'NEEDS_INFORMATION',
  'APPROVED',
  'REJECTED',
  'WITHDRAWN',
  'SUSPENDED',
  'REVOKED'
);

CREATE TABLE "organizer_applications" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "applicant_user_id" UUID NOT NULL,
  "status" "organizer_application_status" NOT NULL DEFAULT 'SUBMITTED',
  "application_message" VARCHAR(2000) NOT NULL,
  "website_url" VARCHAR(500),
  "submitted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewed_at" TIMESTAMPTZ(6),
  "reviewed_by_user_id" UUID,
  "decision_reason" VARCHAR(1000),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "organizer_applications_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "organizer_applications_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "organizer_applications_applicant_user_id_fkey"
    FOREIGN KEY ("applicant_user_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "organizer_applications_reviewed_by_user_id_fkey"
    FOREIGN KEY ("reviewed_by_user_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "organizer_applications_applicant_user_id_submitted_at_idx"
  ON "organizer_applications"("applicant_user_id", "submitted_at");
CREATE INDEX "organizer_applications_status_submitted_at_idx"
  ON "organizer_applications"("status", "submitted_at");
CREATE INDEX "organizer_applications_organization_id_status_idx"
  ON "organizer_applications"("organization_id", "status");

-- Prevent duplicate concurrent submissions while allowing a new application
-- after a previous application receives a final decision.
CREATE UNIQUE INDEX "organizer_applications_one_active_per_organization"
  ON "organizer_applications"("organization_id")
  WHERE "status" IN ('SUBMITTED', 'UNDER_REVIEW', 'NEEDS_INFORMATION');
