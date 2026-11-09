ALTER TABLE "group_members" ADD COLUMN "debt_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "group_members" ADD COLUMN "last_reminded_at" timestamp with time zone;