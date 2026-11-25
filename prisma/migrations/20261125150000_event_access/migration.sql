CREATE TYPE "event_invitation_status" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'REVOKED');
CREATE TYPE "event_access_request_status" AS ENUM ('SUBMITTED', 'APPROVED', 'REJECTED', 'WITHDRAWN');
CREATE TYPE "event_access_grant_status" AS ENUM ('ACTIVE', 'REVOKED', 'EXPIRED');
CREATE TYPE "event_access_grant_source" AS ENUM ('INVITATION', 'ACCESS_REQUEST', 'PLATFORM');

CREATE TABLE "event_invitations" (
  "id" UUID NOT NULL,
  "event_id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "recipient_user_id" UUID NOT NULL,
  "issued_by_user_id" UUID NOT NULL,
  "token_digest" CHAR(64) NOT NULL,
  "status" "event_invitation_status" NOT NULL DEFAULT 'PENDING',
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "accepted_at" TIMESTAMPTZ(6),
  "declined_at" TIMESTAMPTZ(6),
  "revoked_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "event_invitations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "event_invitations_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "event_invitations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "event_invitations_recipient_user_id_fkey" FOREIGN KEY ("recipient_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "event_invitations_issued_by_user_id_fkey" FOREIGN KEY ("issued_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "event_invitations_token_digest_key" ON "event_invitations"("token_digest");
CREATE INDEX "event_invitations_event_id_recipient_user_id_status_idx" ON "event_invitations"("event_id", "recipient_user_id", "status");
CREATE INDEX "event_invitations_status_expires_at_idx" ON "event_invitations"("status", "expires_at");
CREATE UNIQUE INDEX "event_invitations_one_pending_per_recipient" ON "event_invitations"("event_id", "recipient_user_id") WHERE "status" = 'PENDING';

CREATE TABLE "event_access_requests" (
  "id" UUID NOT NULL,
  "event_id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "requester_user_id" UUID NOT NULL,
  "status" "event_access_request_status" NOT NULL DEFAULT 'SUBMITTED',
  "message" VARCHAR(500),
  "decision_reason" VARCHAR(1000),
  "decided_by_user_id" UUID,
  "decided_at" TIMESTAMPTZ(6),
  "withdrawn_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "event_access_requests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "event_access_requests_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "event_access_requests_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "event_access_requests_requester_user_id_fkey" FOREIGN KEY ("requester_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "event_access_requests_event_id_status_created_at_idx" ON "event_access_requests"("event_id", "status", "created_at");
CREATE INDEX "event_access_requests_requester_user_id_created_at_idx" ON "event_access_requests"("requester_user_id", "created_at");
CREATE UNIQUE INDEX "event_access_requests_one_pending_per_user" ON "event_access_requests"("event_id", "requester_user_id") WHERE "status" = 'SUBMITTED';

CREATE TABLE "event_access_grants" (
  "id" UUID NOT NULL,
  "event_id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "source" "event_access_grant_source" NOT NULL,
  "source_id" UUID NOT NULL,
  "status" "event_access_grant_status" NOT NULL DEFAULT 'ACTIVE',
  "can_view_details" BOOLEAN NOT NULL DEFAULT TRUE,
  "can_checkout" BOOLEAN NOT NULL DEFAULT TRUE,
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "revoked_at" TIMESTAMPTZ(6),
  "revoked_by_user_id" UUID,
  "revoke_reason" VARCHAR(1000),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "event_access_grants_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "event_access_grants_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "event_access_grants_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "event_access_grants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "event_access_grants_source_id_nonempty" CHECK ("source_id" IS NOT NULL)
);
CREATE INDEX "event_access_grants_event_id_user_id_status_expires_at_idx" ON "event_access_grants"("event_id", "user_id", "status", "expires_at");
CREATE INDEX "event_access_grants_organization_id_created_at_idx" ON "event_access_grants"("organization_id", "created_at");
CREATE UNIQUE INDEX "event_access_grants_one_active_per_user_event" ON "event_access_grants"("event_id", "user_id") WHERE "status" = 'ACTIVE';

CREATE TABLE "event_access_holds" (
  "id" UUID NOT NULL,
  "event_id" UUID NOT NULL,
  "reason" VARCHAR(1000) NOT NULL,
  "created_by_user_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "released_at" TIMESTAMPTZ(6),
  "released_by_user_id" UUID,
  CONSTRAINT "event_access_holds_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "event_access_holds_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "event_access_holds_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "event_access_holds_released_by_user_id_fkey" FOREIGN KEY ("released_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "event_access_holds_event_id_key" ON "event_access_holds"("event_id");
CREATE INDEX "event_access_holds_released_at_created_at_idx" ON "event_access_holds"("released_at", "created_at");
