CREATE TABLE "cluster_patch" (
  "id" text PRIMARY KEY NOT NULL,
  "cluster_id" text NOT NULL,
  "patch_id" text NOT NULL,
  "status" patch_status DEFAULT 'pending' NOT NULL,
  "applied_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL
);

--> statement-breakpoint
CREATE INDEX "cluster_patch_cluster_id_idx" ON "cluster_patch" USING btree ("cluster_id");
--> statement-breakpoint
CREATE INDEX "cluster_patch_patch_id_idx" ON "cluster_patch" USING btree ("patch_id");
--> statement-breakpoint
ALTER TABLE "cluster_patch" ADD CONSTRAINT "cluster_patch_cluster_id_cluster_id_fk" FOREIGN KEY ("cluster_id") REFERENCES "cluster"("id") ON DELETE cascade ON UPDATE no action;
