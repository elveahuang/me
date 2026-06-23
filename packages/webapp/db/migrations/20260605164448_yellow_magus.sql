CREATE TABLE "messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"text" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
