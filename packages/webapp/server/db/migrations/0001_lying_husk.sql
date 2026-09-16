DROP INDEX "messages_conversation_id_idx";--> statement-breakpoint
CREATE INDEX "messages_conversation_seq_idx" ON "messages" USING btree ("conversation_id","seq");