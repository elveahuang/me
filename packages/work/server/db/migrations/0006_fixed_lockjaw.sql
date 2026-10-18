ALTER TABLE "spaces" ADD COLUMN "default_agent_id" text;--> statement-breakpoint
ALTER TABLE "spaces" ADD COLUMN "local_root" text DEFAULT '' NOT NULL;