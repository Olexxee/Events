CREATE TYPE "user_status" AS ENUM ('ACTIVE', 'SUSPENDED', 'DEACTIVATED');
CREATE TYPE "organization_status" AS ENUM ('ACTIVE', 'SUSPENDED', 'ARCHIVED');
CREATE TYPE "organization_membership_role" AS ENUM ('OWNER', 'ADMIN', 'MEMBER');
CREATE TYPE "organization_membership_status" AS ENUM ('ACTIVE', 'SUSPENDED', 'REMOVED');
CREATE TYPE "platform_role" AS ENUM ('SUPPORT', 'PLATFORM_ADMIN', 'FINANCE_ADMIN', 'SUPER_ADMIN');

CREATE TABLE "users" (
  "id" UUID NOT NULL,
  "email" VARCHAR(320) NOT NULL,
  "email_verified_at" TIMESTAMPTZ(6),
  "status" "user_status" NOT NULL DEFAULT 'ACTIVE',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
CREATE INDEX "users_status_created_at_idx" ON "users"("status", "created_at");

CREATE TABLE "user_profiles" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "display_name" VARCHAR(120),
  "phone" VARCHAR(32),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "user_profiles_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "user_profiles_user_id_key" ON "user_profiles"("user_id");

CREATE TABLE "password_credentials" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "password_hash" VARCHAR(255) NOT NULL,
  "password_changed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "password_credentials_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "password_credentials_user_id_key" ON "password_credentials"("user_id");

CREATE TABLE "sessions" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "family_id" UUID NOT NULL,
  "access_token_hash" CHAR(64) NOT NULL,
  "refresh_token_hash" CHAR(64) NOT NULL,
  "access_expires_at" TIMESTAMPTZ(6) NOT NULL,
  "refresh_expires_at" TIMESTAMPTZ(6) NOT NULL,
  "rotated_at" TIMESTAMPTZ(6),
  "revoked_at" TIMESTAMPTZ(6),
  "revoke_reason" VARCHAR(120),
  "last_used_at" TIMESTAMPTZ(6),
  "ip_address" VARCHAR(64),
  "user_agent" VARCHAR(512),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "sessions_access_token_hash_key" ON "sessions"("access_token_hash");
CREATE UNIQUE INDEX "sessions_refresh_token_hash_key" ON "sessions"("refresh_token_hash");
CREATE INDEX "sessions_user_id_revoked_at_refresh_expires_at_idx" ON "sessions"("user_id", "revoked_at", "refresh_expires_at");
CREATE INDEX "sessions_family_id_revoked_at_idx" ON "sessions"("family_id", "revoked_at");

CREATE TABLE "organizations" (
  "id" UUID NOT NULL,
  "name" VARCHAR(160) NOT NULL,
  "slug" VARCHAR(180) NOT NULL,
  "status" "organization_status" NOT NULL DEFAULT 'ACTIVE',
  "created_by_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");
CREATE INDEX "organizations_status_created_at_idx" ON "organizations"("status", "created_at");

CREATE TABLE "organization_memberships" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "role" "organization_membership_role" NOT NULL DEFAULT 'MEMBER',
  "status" "organization_membership_status" NOT NULL DEFAULT 'ACTIVE',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "organization_memberships_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "organization_memberships_organization_id_user_id_key" ON "organization_memberships"("organization_id", "user_id");
CREATE INDEX "organization_memberships_user_id_status_idx" ON "organization_memberships"("user_id", "status");
CREATE INDEX "organization_memberships_organization_id_status_role_idx" ON "organization_memberships"("organization_id", "status", "role");

CREATE TABLE "platform_role_assignments" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "role" "platform_role" NOT NULL,
  "granted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "granted_by" UUID,
  CONSTRAINT "platform_role_assignments_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "platform_role_assignments_user_id_role_key" ON "platform_role_assignments"("user_id", "role");
CREATE INDEX "platform_role_assignments_role_granted_at_idx" ON "platform_role_assignments"("role", "granted_at");

ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "password_credentials" ADD CONSTRAINT "password_credentials_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "organization_memberships" ADD CONSTRAINT "organization_memberships_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "organization_memberships" ADD CONSTRAINT "organization_memberships_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "platform_role_assignments" ADD CONSTRAINT "platform_role_assignments_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
