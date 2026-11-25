CREATE TYPE "vybe_category" AS ENUM (
  'ACCOMMODATION',
  'DINING',
  'DRINKS',
  'TABLES_LOUNGES',
  'VIP_EXPERIENCES',
  'OTHER_SERVICES'
);

CREATE TYPE "vybe_provider_application_status" AS ENUM (
  'SUBMITTED',
  'UNDER_REVIEW',
  'NEEDS_INFORMATION',
  'APPROVED',
  'REJECTED',
  'WITHDRAWN'
);

CREATE TYPE "vybe_provider_approval_status" AS ENUM (
  'ACTIVE',
  'SUSPENDED',
  'REVOKED',
  'EXPIRED'
);

CREATE TYPE "vybe_provider_review_action" AS ENUM (
  'REVIEW_STARTED',
  'INFORMATION_REQUESTED',
  'APPROVED',
  'REJECTED',
  'SUSPENDED',
  'REVOKED'
);

CREATE TYPE "vybe_evidence_status" AS ENUM (
  'PENDING',
  'ACCEPTED',
  'REJECTED',
  'EXPIRED',
  'SUPERSEDED'
);

CREATE TABLE "vybe_provider_profiles" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "vybe_provider_profiles_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "vybe_provider_applications" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "applicant_user_id" UUID NOT NULL,
  "category" "vybe_category" NOT NULL,
  "service_description" VARCHAR(1500) NOT NULL,
  "supply_authority_statement" VARCHAR(2000) NOT NULL,
  "supply_authority_attested" BOOLEAN NOT NULL DEFAULT false,
  "terms_version" VARCHAR(40) NOT NULL,
  "terms_accepted_at" TIMESTAMPTZ(6) NOT NULL,
  "status" "vybe_provider_application_status" NOT NULL DEFAULT 'SUBMITTED',
  "submitted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewed_at" TIMESTAMPTZ(6),
  "decision_reason" VARCHAR(1000),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "vybe_provider_applications_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "vybe_provider_applications_attestation_check" CHECK ("supply_authority_attested" = true)
);

CREATE TABLE "vybe_provider_application_locations" (
  "id" UUID NOT NULL,
  "application_id" UUID NOT NULL,
  "city" VARCHAR(100) NOT NULL,
  "state" VARCHAR(100) NOT NULL,
  "country" VARCHAR(100) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "vybe_provider_application_locations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "vybe_provider_evidence" (
  "id" UUID NOT NULL,
  "application_id" UUID NOT NULL,
  "evidence_type" VARCHAR(100) NOT NULL,
  "requirement_reason" VARCHAR(1000) NOT NULL,
  "storage_reference" VARCHAR(1000) NOT NULL,
  "status" "vybe_evidence_status" NOT NULL DEFAULT 'PENDING',
  "reviewed_by_user_id" UUID,
  "reviewed_at" TIMESTAMPTZ(6),
  "review_reason" VARCHAR(1000),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "vybe_provider_evidence_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "vybe_provider_reviews" (
  "id" UUID NOT NULL,
  "application_id" UUID NOT NULL,
  "reviewer_user_id" UUID NOT NULL,
  "action" "vybe_provider_review_action" NOT NULL,
  "reason" VARCHAR(1000) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "vybe_provider_reviews_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "vybe_provider_approvals" (
  "id" UUID NOT NULL,
  "application_id" UUID NOT NULL,
  "provider_profile_id" UUID NOT NULL,
  "category" "vybe_category" NOT NULL,
  "status" "vybe_provider_approval_status" NOT NULL DEFAULT 'ACTIVE',
  "locations" JSONB NOT NULL DEFAULT '[]',
  "conditions" JSONB NOT NULL DEFAULT '[]',
  "approved_by_user_id" UUID NOT NULL,
  "approved_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMPTZ(6),
  "suspended_at" TIMESTAMPTZ(6),
  "suspended_by_user_id" UUID,
  "suspension_reason" VARCHAR(1000),
  "revoked_at" TIMESTAMPTZ(6),
  "revoked_by_user_id" UUID,
  "revocation_reason" VARCHAR(1000),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "vybe_provider_approvals_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "vybe_provider_profiles_organization_id_key" ON "vybe_provider_profiles"("organization_id");
CREATE UNIQUE INDEX "vybe_provider_approvals_application_id_key" ON "vybe_provider_approvals"("application_id");
CREATE INDEX "vybe_provider_approvals_profile_category_status_idx" ON "vybe_provider_approvals"("provider_profile_id", "category", "status");
CREATE UNIQUE INDEX "vybe_provider_approvals_one_active_per_category_key" ON "vybe_provider_approvals"("provider_profile_id", "category") WHERE "status" = 'ACTIVE';
CREATE UNIQUE INDEX "vybe_provider_application_locations_scope_key" ON "vybe_provider_application_locations"("application_id", "city", "state", "country");
CREATE UNIQUE INDEX "vybe_provider_applications_one_active_per_org_category_key"
  ON "vybe_provider_applications"("organization_id", "category")
  WHERE "status" IN ('SUBMITTED', 'UNDER_REVIEW', 'NEEDS_INFORMATION');

CREATE INDEX "vybe_provider_applications_applicant_submitted_idx" ON "vybe_provider_applications"("applicant_user_id", "submitted_at");
CREATE INDEX "vybe_provider_applications_status_submitted_idx" ON "vybe_provider_applications"("status", "submitted_at");
CREATE INDEX "vybe_provider_applications_org_category_status_idx" ON "vybe_provider_applications"("organization_id", "category", "status", "submitted_at");
CREATE INDEX "vybe_provider_application_locations_geo_idx" ON "vybe_provider_application_locations"("city", "state", "country");
CREATE INDEX "vybe_provider_evidence_application_status_idx" ON "vybe_provider_evidence"("application_id", "status");
CREATE INDEX "vybe_provider_reviews_application_created_idx" ON "vybe_provider_reviews"("application_id", "created_at");
CREATE INDEX "vybe_provider_reviews_reviewer_created_idx" ON "vybe_provider_reviews"("reviewer_user_id", "created_at");
CREATE INDEX "vybe_provider_approvals_category_status_expiry_idx" ON "vybe_provider_approvals"("category", "status", "expires_at");

ALTER TABLE "vybe_provider_profiles"
  ADD CONSTRAINT "vybe_provider_profiles_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "vybe_provider_applications"
  ADD CONSTRAINT "vybe_provider_applications_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "vybe_provider_applications"
  ADD CONSTRAINT "vybe_provider_applications_applicant_user_id_fkey"
  FOREIGN KEY ("applicant_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "vybe_provider_application_locations"
  ADD CONSTRAINT "vybe_provider_application_locations_application_id_fkey"
  FOREIGN KEY ("application_id") REFERENCES "vybe_provider_applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "vybe_provider_evidence"
  ADD CONSTRAINT "vybe_provider_evidence_application_id_fkey"
  FOREIGN KEY ("application_id") REFERENCES "vybe_provider_applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "vybe_provider_reviews"
  ADD CONSTRAINT "vybe_provider_reviews_application_id_fkey"
  FOREIGN KEY ("application_id") REFERENCES "vybe_provider_applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "vybe_provider_reviews"
  ADD CONSTRAINT "vybe_provider_reviews_reviewer_user_id_fkey"
  FOREIGN KEY ("reviewer_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "vybe_provider_approvals"
  ADD CONSTRAINT "vybe_provider_approvals_application_id_fkey"
  FOREIGN KEY ("application_id") REFERENCES "vybe_provider_applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "vybe_provider_approvals"
  ADD CONSTRAINT "vybe_provider_approvals_provider_profile_id_fkey"
  FOREIGN KEY ("provider_profile_id") REFERENCES "vybe_provider_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "vybe_provider_approvals"
  ADD CONSTRAINT "vybe_provider_approvals_approved_by_user_id_fkey"
  FOREIGN KEY ("approved_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "vybe_provider_approvals"
  ADD CONSTRAINT "vybe_provider_approvals_suspended_by_user_id_fkey"
  FOREIGN KEY ("suspended_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "vybe_provider_approvals"
  ADD CONSTRAINT "vybe_provider_approvals_revoked_by_user_id_fkey"
  FOREIGN KEY ("revoked_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
