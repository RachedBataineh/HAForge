-- Add S3 credentials columns to user table
ALTER TABLE "user" ADD COLUMN "s3_endpoint" text;
ALTER TABLE "user" ADD COLUMN "s3_region" text;
ALTER TABLE "user" ADD COLUMN "s3_access_key" text;
ALTER TABLE "user" ADD COLUMN "s3_secret_key" text;

-- Migrate existing S3 credentials from cluster_backups to user (first cluster wins)
UPDATE "user" u
SET
  s3_endpoint = cb.s3_endpoint,
  s3_region = cb.s3_region,
  s3_access_key = cb.s3_access_key,
  s3_secret_key = cb.s3_secret_key
FROM (
  SELECT DISTINCT ON (c.user_id)
    c.user_id,
    cb_inner.s3_endpoint,
    cb_inner.s3_region,
    cb_inner.s3_access_key,
    cb_inner.s3_secret_key
  FROM cluster_backups cb_inner
  JOIN "cluster" c ON c.id = cb_inner.cluster_id
  ORDER BY c.user_id, cb_inner.created_at ASC
) cb
WHERE u.id = cb.user_id
  AND u.s3_endpoint IS NULL;

-- Remove S3 credential columns from cluster_backups (keep only bucket)
ALTER TABLE "cluster_backups" DROP COLUMN IF EXISTS "s3_endpoint";
ALTER TABLE "cluster_backups" DROP COLUMN IF EXISTS "s3_region";
ALTER TABLE "cluster_backups" DROP COLUMN IF EXISTS "s3_access_key";
ALTER TABLE "cluster_backups" DROP COLUMN IF EXISTS "s3_secret_key";
ALTER TABLE "cluster_backups" DROP COLUMN IF EXISTS "s3_path_prefix";
