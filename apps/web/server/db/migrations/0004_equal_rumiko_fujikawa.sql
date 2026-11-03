ALTER TABLE "attachments" ADD COLUMN "space_id" text DEFAULT 'default' NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_bases" ADD COLUMN "space_id" text DEFAULT 'default' NOT NULL;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_bases" ADD CONSTRAINT "knowledge_bases_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attachments_space_created_idx" ON "attachments" USING btree ("space_id","created_at");--> statement-breakpoint
CREATE INDEX "knowledge_bases_space_idx" ON "knowledge_bases" USING btree ("space_id");