CREATE TABLE "system_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"site_title" text DEFAULT 'ME' NOT NULL,
	"default_locale" text DEFAULT 'zh-CN' NOT NULL,
	"theme_mode" text DEFAULT 'system' NOT NULL,
	"theme_brand" text DEFAULT 'green' NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
