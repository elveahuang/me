CREATE TABLE "session_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"trigger" text DEFAULT 'chat' NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"request_id" text DEFAULT '' NOT NULL,
	"error_code" text,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"finished_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "session_runs" ADD CONSTRAINT "session_runs_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "session_runs_conversation_started_idx" ON "session_runs" USING btree ("conversation_id","started_at");--> statement-breakpoint
CREATE INDEX "session_runs_status_idx" ON "session_runs" USING btree ("status");