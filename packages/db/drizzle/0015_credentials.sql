CREATE TABLE "credentials" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"scheme" text NOT NULL,
	"header_name" text,
	"secret" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"rotated_by" uuid NOT NULL,
	"rotated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credentials_name_unique" UNIQUE("name"),
	CONSTRAINT "credentials_header_name" CHECK (("credentials"."scheme" = 'header') = ("credentials"."header_name" is not null))
);
--> statement-breakpoint
ALTER TABLE "credentials" ADD CONSTRAINT "credentials_created_by_participants_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."participants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credentials" ADD CONSTRAINT "credentials_rotated_by_participants_id_fk" FOREIGN KEY ("rotated_by") REFERENCES "public"."participants"("id") ON DELETE no action ON UPDATE no action;