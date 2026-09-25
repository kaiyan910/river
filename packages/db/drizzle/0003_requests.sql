CREATE TABLE "request_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "request_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"request_id" uuid NOT NULL,
	"type" text NOT NULL,
	"actor_id" uuid,
	"task_id" uuid,
	"comment" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" integer GENERATED ALWAYS AS IDENTITY (sequence name "requests_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"process_version_id" uuid NOT NULL,
	"initiator_id" uuid NOT NULL,
	"title" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "requests_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"request_id" uuid NOT NULL,
	"node_id" text NOT NULL,
	"node_name" text NOT NULL,
	"assignee_id" uuid NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"outcome" text,
	"comment" text,
	"completed_by" uuid,
	"completed_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "request_events" ADD CONSTRAINT "request_events_request_id_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_events" ADD CONSTRAINT "request_events_actor_id_participants_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."participants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_events" ADD CONSTRAINT "request_events_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_process_version_id_process_versions_id_fk" FOREIGN KEY ("process_version_id") REFERENCES "public"."process_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_initiator_id_participants_id_fk" FOREIGN KEY ("initiator_id") REFERENCES "public"."participants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_request_id_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assignee_id_participants_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."participants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_completed_by_participants_id_fk" FOREIGN KEY ("completed_by") REFERENCES "public"."participants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "request_events_request_id_id_index" ON "request_events" USING btree ("request_id","id");--> statement-breakpoint
CREATE INDEX "requests_initiator_id_index" ON "requests" USING btree ("initiator_id");--> statement-breakpoint
CREATE INDEX "tasks_request_id_index" ON "tasks" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "tasks_assignee_id_status_index" ON "tasks" USING btree ("assignee_id","status");--> statement-breakpoint
CREATE FUNCTION "request_events_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	RAISE EXCEPTION 'request_events 只能新增，不能修改或刪除';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "request_events_append_only" BEFORE UPDATE OR DELETE ON "request_events" FOR EACH STATEMENT EXECUTE FUNCTION "request_events_append_only"();
