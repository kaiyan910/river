CREATE TABLE "service_account_processes" (
	"service_account_id" uuid NOT NULL,
	"process_id" uuid NOT NULL,
	CONSTRAINT "service_account_processes_service_account_id_process_id_pk" PRIMARY KEY("service_account_id","process_id")
);
--> statement-breakpoint
CREATE TABLE "service_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"api_key_hash" text NOT NULL,
	"api_key_prefix" text NOT NULL,
	"api_key_issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_accounts_name_unique" UNIQUE("name"),
	CONSTRAINT "service_accounts_api_key_hash_unique" UNIQUE("api_key_hash")
);
--> statement-breakpoint
ALTER TABLE "request_data" ALTER COLUMN "submitted_by" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "requests" ALTER COLUMN "initiator_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "requests" ADD COLUMN "service_account_id" uuid;--> statement-breakpoint
ALTER TABLE "service_account_processes" ADD CONSTRAINT "service_account_processes_service_account_id_service_accounts_id_fk" FOREIGN KEY ("service_account_id") REFERENCES "public"."service_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_account_processes" ADD CONSTRAINT "service_account_processes_process_id_processes_id_fk" FOREIGN KEY ("process_id") REFERENCES "public"."processes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_service_account_id_service_accounts_id_fk" FOREIGN KEY ("service_account_id") REFERENCES "public"."service_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "requests_service_account_id_index" ON "requests" USING btree ("service_account_id");--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_has_initiator" CHECK (num_nonnulls("requests"."initiator_id", "requests"."service_account_id") >= 1);