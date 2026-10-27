ALTER TABLE "events" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "projects" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "tasks" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "notes" DROP CONSTRAINT "notes_project_id_projects_id_fk";
--> statement-breakpoint
ALTER TABLE "notes" DROP COLUMN "project_id";
--> statement-breakpoint
DROP TABLE "events" CASCADE;
--> statement-breakpoint
DROP TABLE "projects" CASCADE;
--> statement-breakpoint
DROP TABLE "tasks" CASCADE;
--> statement-breakpoint
CREATE TABLE "schedules" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"prompt" text DEFAULT '' NOT NULL,
	"agent_id" text NOT NULL,
	"kind" text DEFAULT 'daily' NOT NULL,
	"time_text" text DEFAULT '' NOT NULL,
	"interval_minutes" integer,
	"days" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"starts_at" timestamp NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"next_run_at" timestamp NOT NULL,
	"last_run_at" timestamp,
	"last_status" text DEFAULT '' NOT NULL,
	"last_error" text DEFAULT '' NOT NULL,
	"last_conversation_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_last_conversation_id_conversations_id_fk" FOREIGN KEY ("last_conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "schedules_enabled_next_idx" ON "schedules" USING btree ("enabled","next_run_at");
