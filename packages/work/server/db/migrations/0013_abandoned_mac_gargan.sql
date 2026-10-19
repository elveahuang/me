CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "content_text" text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE INDEX "conversations_title_trgm_idx" ON "conversations" USING gin ("title" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "kb_documents_title_trgm_idx" ON "kb_documents" USING gin ("title" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "messages_content_text_trgm_idx" ON "messages" USING gin ("content_text" gin_trgm_ops);