ALTER TABLE "auth_refresh_tokens" ADD COLUMN "encrypted_successor_payload" text;--> statement-breakpoint
ALTER TABLE "auth_refresh_tokens" ADD COLUMN "retry_expires_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "auth_refresh_tokens_retry_expiry_idx" ON "auth_refresh_tokens" USING btree ("retry_expires_at");