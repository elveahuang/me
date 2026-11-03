CREATE TABLE "approvals" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"run_id" text,
	"tool_call_id" text,
	"tool_name" text NOT NULL,
	"risk" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"decided_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "approval_mode" text DEFAULT 'auto' NOT NULL;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "approvals_conversation_status_idx" ON "approvals" USING btree ("conversation_id","status");--> statement-breakpoint
CREATE INDEX "approvals_status_created_idx" ON "approvals" USING btree ("status","created_at");