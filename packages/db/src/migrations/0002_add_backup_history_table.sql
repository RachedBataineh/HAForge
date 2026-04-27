-- Create backup_status enum
CREATE TYPE "public"."backup_status" AS ENUM('running', 'completed', 'failed', 'deleted');

-- Create backup_history table
CREATE TABLE "backup_history" (
	"id" text PRIMARY KEY NOT NULL,
	"cluster_id" text NOT NULL,
	"config_id" text NOT NULL,
	"filename" text NOT NULL,
	"database_name" text NOT NULL,
	"status" "backup_status" DEFAULT 'running' NOT NULL,
	"file_size_bytes" integer,
	"s3_key" text,
	"error_message" text,
	"triggered_by" text DEFAULT 'manual',
	"started_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);

-- Add foreign keys
ALTER TABLE "backup_history" ADD CONSTRAINT "backup_history_cluster_id_fkey" FOREIGN KEY ("cluster_id") REFERENCES "cluster"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "backup_history" ADD CONSTRAINT "backup_history_config_id_fkey" FOREIGN KEY ("config_id") REFERENCES "cluster_backups"("id") ON DELETE cascade ON UPDATE no action;

-- Add indexes
CREATE INDEX "backup_history_cluster_id_idx" ON "backup_history" ("cluster_id");
CREATE INDEX "backup_history_status_idx" ON "backup_history" ("status");
