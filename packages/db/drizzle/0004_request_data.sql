CREATE TABLE "request_data" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"node_id" text NOT NULL,
	"form_id" text NOT NULL,
	"data" jsonb NOT NULL,
	"submitted_by" uuid NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "request_data_request_id_node_id_unique" UNIQUE("request_id","node_id")
);
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "kind" text DEFAULT 'approval' NOT NULL;--> statement-breakpoint
ALTER TABLE "request_data" ADD CONSTRAINT "request_data_request_id_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_data" ADD CONSTRAINT "request_data_submitted_by_participants_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."participants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Form 從這一版開始放在 DSL 裡；既有的草稿與 Process Version 補上空的 forms，內容不變。
UPDATE "processes" SET "draft" = jsonb_set("draft", '{forms}', '[]'::jsonb) WHERE "draft" IS NOT NULL AND NOT ("draft" ? 'forms');--> statement-breakpoint
UPDATE "process_versions" SET "dsl" = jsonb_set("dsl", '{forms}', '[]'::jsonb) WHERE NOT ("dsl" ? 'forms');
