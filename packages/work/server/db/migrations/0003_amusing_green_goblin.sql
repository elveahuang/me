CREATE TABLE "automation_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"schedule_id" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"trigger" text DEFAULT 'schedule' NOT NULL,
	"scheduled_for" timestamp,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"finished_at" timestamp,
	"duration_ms" integer,
	"prompt" text DEFAULT '' NOT NULL,
	"output_conversation_id" text,
	"error" text DEFAULT '' NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "spaces" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"icon" text DEFAULT '🗂️' NOT NULL,
	"instructions" text DEFAULT '' NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
INSERT INTO "spaces" ("id", "name", "description", "icon", "instructions")
VALUES ('default', '默认空间', '会话、资料与自动化的默认工作上下文', '🗂️', '')
ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "space_id" text DEFAULT 'default' NOT NULL;--> statement-breakpoint
ALTER TABLE "schedules" ADD COLUMN "space_id" text DEFAULT 'default' NOT NULL;--> statement-breakpoint
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_schedule_id_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."schedules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_output_conversation_id_conversations_id_fk" FOREIGN KEY ("output_conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "automation_runs_schedule_started_idx" ON "automation_runs" USING btree ("schedule_id","started_at");--> statement-breakpoint
CREATE INDEX "automation_runs_status_started_idx" ON "automation_runs" USING btree ("status","started_at");--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversations_space_updated_idx" ON "conversations" USING btree ("space_id","updated_at");--> statement-breakpoint
CREATE INDEX "schedules_space_idx" ON "schedules" USING btree ("space_id");