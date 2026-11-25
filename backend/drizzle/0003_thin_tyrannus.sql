CREATE TABLE "auth_refresh_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"parent_token_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"idempotency_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_refresh_tokens_expiry_after_creation" CHECK ("auth_refresh_tokens"."expires_at" > "auth_refresh_tokens"."created_at")
);
--> statement-breakpoint
CREATE TABLE "auth_session_families" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"absolute_expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_reason" text,
	"device_label" text,
	"initial_ip_address" "inet",
	"initial_user_agent" text,
	"last_active_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_session_families_expiry_after_creation" CHECK ("auth_session_families"."absolute_expires_at" > "auth_session_families"."created_at")
);
--> statement-breakpoint
ALTER TABLE "auth_refresh_tokens" ADD CONSTRAINT "auth_refresh_tokens_family_id_auth_session_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."auth_session_families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_refresh_tokens" ADD CONSTRAINT "auth_refresh_tokens_parent_token_id_auth_refresh_tokens_id_fk" FOREIGN KEY ("parent_token_id") REFERENCES "public"."auth_refresh_tokens"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_session_families" ADD CONSTRAINT "auth_session_families_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "auth_refresh_tokens_hash_unique" ON "auth_refresh_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "auth_refresh_tokens_family_id_idx" ON "auth_refresh_tokens" USING btree ("family_id");--> statement-breakpoint
CREATE INDEX "auth_refresh_tokens_parent_token_idx" ON "auth_refresh_tokens" USING btree ("parent_token_id");--> statement-breakpoint
CREATE INDEX "auth_refresh_tokens_expiry_idx" ON "auth_refresh_tokens" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "auth_session_families_user_id_idx" ON "auth_session_families" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "auth_session_families_expiry_idx" ON "auth_session_families" USING btree ("absolute_expires_at");