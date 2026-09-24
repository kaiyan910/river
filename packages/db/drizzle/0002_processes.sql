CREATE TABLE "process_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"process_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"dsl" jsonb NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"published_by" uuid NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "process_versions_process_id_version_unique" UNIQUE("process_id","version")
);
--> statement-breakpoint
CREATE TABLE "processes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"draft" jsonb,
	"draft_saved_at" timestamp with time zone,
	"draft_saved_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "processes_name_unique" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "process_versions" ADD CONSTRAINT "process_versions_process_id_processes_id_fk" FOREIGN KEY ("process_id") REFERENCES "public"."processes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "process_versions" ADD CONSTRAINT "process_versions_published_by_participants_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."participants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "processes" ADD CONSTRAINT "processes_draft_saved_by_participants_id_fk" FOREIGN KEY ("draft_saved_by") REFERENCES "public"."participants"("id") ON DELETE no action ON UPDATE no action;