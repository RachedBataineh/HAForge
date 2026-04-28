-- Remove backup feature: drop tables, enum, and S3 columns from user

DROP TABLE IF EXISTS "backup_history" CASCADE;
DROP TABLE IF EXISTS "cluster_backups" CASCADE;
DROP TYPE IF EXISTS "backup_status";

ALTER TABLE "user" DROP COLUMN IF EXISTS "s3_endpoint";
ALTER TABLE "user" DROP COLUMN IF EXISTS "s3_region";
ALTER TABLE "user" DROP COLUMN IF EXISTS "s3_access_key";
ALTER TABLE "user" DROP COLUMN IF EXISTS "s3_secret_key";
