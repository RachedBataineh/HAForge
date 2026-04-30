DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'execution_type') THEN
        CREATE TYPE execution_type AS ENUM ('deploy', 'patch');
    END IF;
END $$;

ALTER TABLE "execution" ADD COLUMN IF NOT EXISTS "execution_type" execution_type DEFAULT 'deploy' NOT NULL;
