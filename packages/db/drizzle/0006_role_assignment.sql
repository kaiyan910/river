ALTER TABLE "tasks" ALTER COLUMN "assignee_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "role_id" uuid;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tasks_role_id_status_index" ON "tasks" USING btree ("role_id","status");--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_one_assignee" CHECK (num_nonnulls("tasks"."assignee_id", "tasks"."role_id") = 1);