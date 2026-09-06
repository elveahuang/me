ALTER TABLE "agents" ADD COLUMN "temperature" real DEFAULT 0.7;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "max_tokens" integer;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "max_steps" integer DEFAULT 6 NOT NULL;