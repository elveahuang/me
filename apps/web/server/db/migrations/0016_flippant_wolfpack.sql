CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
ALTER TABLE "kb_chunks" ADD COLUMN "embedding_v" vector(1536);--> statement-breakpoint
CREATE INDEX "kb_chunks_embedding_v_hnsw_idx" ON "kb_chunks" USING hnsw ("embedding_v" vector_cosine_ops);
