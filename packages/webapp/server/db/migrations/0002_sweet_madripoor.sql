CREATE TABLE "attachments" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"storage_config_id" text,
	"object_key" text NOT NULL,
	"filename" text NOT NULL,
	"mime_type" text DEFAULT 'application/octet-stream' NOT NULL,
	"size" integer DEFAULT 0 NOT NULL,
	"category" text DEFAULT 'other' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bulletins" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"image_url" text DEFAULT '' NOT NULL,
	"link_url" text DEFAULT '' NOT NULL,
	"link_text" text DEFAULT '' NOT NULL,
	"position" text DEFAULT 'home' NOT NULL,
	"level" text DEFAULT 'info' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"starts_at" timestamp,
	"ends_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "news" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"cover_image" text DEFAULT '' NOT NULL,
	"category" text DEFAULT 'general' NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL,
	"view_count" integer DEFAULT 0 NOT NULL,
	"author_id" text,
	"published_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_recipients" (
	"id" text PRIMARY KEY NOT NULL,
	"notification_id" text NOT NULL,
	"user_id" text NOT NULL,
	"read_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"type" text DEFAULT 'system' NOT NULL,
	"level" text DEFAULT 'info' NOT NULL,
	"audience" text DEFAULT 'all' NOT NULL,
	"link_url" text DEFAULT '' NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "storage_configs" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"provider" text DEFAULT 's3' NOT NULL,
	"endpoint" text NOT NULL,
	"region" text DEFAULT 'us-east-1' NOT NULL,
	"bucket" text NOT NULL,
	"access_key_id" text DEFAULT '' NOT NULL,
	"secret_access_key" text DEFAULT '' NOT NULL,
	"force_path_style" boolean DEFAULT true NOT NULL,
	"public_base_url" text DEFAULT '' NOT NULL,
	"prefix" text DEFAULT 'uploads' NOT NULL,
	"max_file_size_mb" integer DEFAULT 20 NOT NULL,
	"allowed_mime_types" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_storage_config_id_storage_configs_id_fk" FOREIGN KEY ("storage_config_id") REFERENCES "public"."storage_configs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "news" ADD CONSTRAINT "news_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_recipients" ADD CONSTRAINT "notification_recipients_notification_id_notifications_id_fk" FOREIGN KEY ("notification_id") REFERENCES "public"."notifications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_recipients" ADD CONSTRAINT "notification_recipients_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attachments_user_id_idx" ON "attachments" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "attachments_created_at_idx" ON "attachments" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "bulletins_position_enabled_idx" ON "bulletins" USING btree ("position","enabled");--> statement-breakpoint
CREATE INDEX "news_status_published_idx" ON "news" USING btree ("status","published_at");--> statement-breakpoint
CREATE INDEX "news_category_idx" ON "news" USING btree ("category");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_recipients_unique_idx" ON "notification_recipients" USING btree ("notification_id","user_id");--> statement-breakpoint
CREATE INDEX "notification_recipients_user_idx" ON "notification_recipients" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "notifications_created_at_idx" ON "notifications" USING btree ("created_at");