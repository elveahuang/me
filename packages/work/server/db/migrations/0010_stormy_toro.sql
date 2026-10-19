CREATE TABLE "job_chunks" (
	"id" text PRIMARY KEY NOT NULL,
	"job_id" text NOT NULL,
	"seq" bigserial NOT NULL,
	"stream" text DEFAULT 'stdout' NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text,
	"agent_id" text,
	"command" text NOT NULL,
	"cwd" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"pid" integer,
	"exit_code" integer,
	"error" text DEFAULT '' NOT NULL,
	"output_bytes" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"finished_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "job_chunks" ADD CONSTRAINT "job_chunks_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "job_chunks_job_seq_idx" ON "job_chunks" USING btree ("job_id","seq");--> statement-breakpoint
CREATE INDEX "jobs_status_created_idx" ON "jobs" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "jobs_conversation_idx" ON "jobs" USING btree ("conversation_id","created_at");