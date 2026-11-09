CREATE TYPE "public"."settlement_status" AS ENUM('pending', 'confirmed', 'rejected', 'cancelled');--> statement-breakpoint
ALTER TYPE "public"."group_event_type" ADD VALUE 'settlement_created';--> statement-breakpoint
ALTER TYPE "public"."group_event_type" ADD VALUE 'settlement_confirmed';--> statement-breakpoint
ALTER TYPE "public"."group_event_type" ADD VALUE 'settlement_rejected';--> statement-breakpoint
ALTER TYPE "public"."group_event_type" ADD VALUE 'settlement_cancelled';--> statement-breakpoint
CREATE TABLE "settlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"from_id" uuid NOT NULL,
	"to_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"comment" text,
	"status" "settlement_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	CONSTRAINT "settlements_amount_positive" CHECK ("settlements"."amount" > 0),
	CONSTRAINT "settlements_not_self" CHECK ("settlements"."from_id" <> "settlements"."to_id")
);
--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_from_id_users_id_fk" FOREIGN KEY ("from_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_to_id_users_id_fk" FOREIGN KEY ("to_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "settlements_group_idx" ON "settlements" USING btree ("group_id","status");