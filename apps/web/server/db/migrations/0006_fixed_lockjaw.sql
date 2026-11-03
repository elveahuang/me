ALTER TABLE "spaces" ADD COLUMN IF NOT EXISTS "default_agent_id" text;--> statement-breakpoint
ALTER TABLE "spaces" ADD COLUMN IF NOT EXISTS "local_root" text DEFAULT '' NOT NULL;