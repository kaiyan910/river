CREATE TABLE "process_initiator_roles" (
	"process_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	CONSTRAINT "process_initiator_roles_process_id_role_id_pk" PRIMARY KEY("process_id","role_id")
);
--> statement-breakpoint
CREATE TABLE "process_observer_roles" (
	"process_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	CONSTRAINT "process_observer_roles_process_id_role_id_pk" PRIMARY KEY("process_id","role_id")
);
--> statement-breakpoint
ALTER TABLE "process_initiator_roles" ADD CONSTRAINT "process_initiator_roles_process_id_processes_id_fk" FOREIGN KEY ("process_id") REFERENCES "public"."processes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "process_initiator_roles" ADD CONSTRAINT "process_initiator_roles_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "process_observer_roles" ADD CONSTRAINT "process_observer_roles_process_id_processes_id_fk" FOREIGN KEY ("process_id") REFERENCES "public"."processes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "process_observer_roles" ADD CONSTRAINT "process_observer_roles_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "process_observer_roles_role_id_index" ON "process_observer_roles" USING btree ("role_id");