CREATE TABLE "session_events" (
	"conversation_id" text NOT NULL,
	"seq" bigint NOT NULL,
	"type" text NOT NULL,
	"turn_id" text,
	"step_id" text,
	"surface_op" jsonb,
	"data" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "session_events_conversation_id_seq_pk" PRIMARY KEY("conversation_id","seq")
);
--> statement-breakpoint
ALTER TABLE "session_events" ADD CONSTRAINT "session_events_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "session_events_type_idx" ON "session_events" USING btree ("type");