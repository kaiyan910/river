ALTER TABLE "request_data" DROP CONSTRAINT "request_data_request_id_node_id_unique";--> statement-breakpoint
ALTER TABLE "request_data" ADD COLUMN "round" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "requests" ADD COLUMN "round" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "round" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "request_data" ADD CONSTRAINT "request_data_request_id_node_id_round_unique" UNIQUE("request_id","node_id","round");