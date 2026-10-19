ALTER TABLE "schedules" ADD COLUMN "revision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "schedules" ADD COLUMN "deleted_at" timestamp;