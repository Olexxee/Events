CREATE TYPE "identity_action_token_type" AS ENUM ('EMAIL_VERIFICATION', 'PASSWORD_RESET');

CREATE TABLE "identity_action_tokens" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "token_hash" CHAR(64) NOT NULL,
  "type" "identity_action_token_type" NOT NULL,
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "consumed_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "identity_action_tokens_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "identity_action_tokens_token_hash_key" ON "identity_action_tokens"("token_hash");
CREATE INDEX "identity_action_tokens_user_type_state_idx" ON "identity_action_tokens"("user_id", "type", "consumed_at", "expires_at");
CREATE INDEX "identity_action_tokens_expiry_idx" ON "identity_action_tokens"("expires_at");
ALTER TABLE "identity_action_tokens" ADD CONSTRAINT "identity_action_tokens_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "identity_action_requests" (
  "id" UUID NOT NULL,
  "email_hash" CHAR(64) NOT NULL,
  "ip_address" VARCHAR(64) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "identity_action_requests_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "identity_action_requests_rate_idx" ON "identity_action_requests"("email_hash", "ip_address", "created_at");
