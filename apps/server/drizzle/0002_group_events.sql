CREATE TYPE "public"."group_event_type" AS ENUM('expense_created', 'expense_updated', 'expense_deleted', 'member_joined', 'group_updated');--> statement-breakpoint
CREATE TABLE "group_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"type" "group_event_type" NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "group_events" ADD CONSTRAINT "group_events_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_events" ADD CONSTRAINT "group_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "group_events_group_idx" ON "group_events" USING btree ("group_id","created_at");