CREATE TABLE "process_schedules" (
	"process_id" uuid PRIMARY KEY NOT NULL,
	"cron" text NOT NULL,
	"timezone" text NOT NULL,
	"initiator_id" uuid NOT NULL,
	"updated_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "process_schedules" ADD CONSTRAINT "process_schedules_process_id_processes_id_fk" FOREIGN KEY ("process_id") REFERENCES "public"."processes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "process_schedules" ADD CONSTRAINT "process_schedules_initiator_id_participants_id_fk" FOREIGN KEY ("initiator_id") REFERENCES "public"."participants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "process_schedules" ADD CONSTRAINT "process_schedules_updated_by_participants_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."participants"("id") ON DELETE no action ON UPDATE no action;