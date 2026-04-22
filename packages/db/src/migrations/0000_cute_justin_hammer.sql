CREATE TYPE "public"."cluster_status" AS ENUM('draft', 'configuring', 'deploying', 'running', 'error', 'destroyed');--> statement-breakpoint
CREATE TYPE "public"."cluster_type" AS ENUM('haproxy', 'hetzner_lb');--> statement-breakpoint
CREATE TYPE "public"."execution_status" AS ENUM('running', 'completed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."server_role" AS ENUM('postgresql_1', 'postgresql_2', 'postgresql_3', 'haproxy_1', 'haproxy_2', 'haproxy_3');--> statement-breakpoint
CREATE TYPE "public"."server_status" AS ENUM('pending', 'connecting', 'installing', 'configuring', 'ready', 'error');--> statement-breakpoint
CREATE TYPE "public"."step_status" AS ENUM('pending', 'running', 'completed', 'failed', 'skipped');--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"hetzner_api_token" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cluster" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"status" "cluster_status" DEFAULT 'draft' NOT NULL,
	"cluster_type" "cluster_type" DEFAULT 'haproxy' NOT NULL,
	"user_id" text NOT NULL,
	"floating_ip" text,
	"hetzner_api_token" text,
	"floating_ip_id" text,
	"load_balancer_id" text,
	"load_balancer_ip" text,
	"wizard_step" integer,
	"superuser_password" text,
	"replication_password" text,
	"superuser_username" text DEFAULT 'postgres',
	"initial_database" text DEFAULT 'postgres',
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "execution_log" (
	"id" text PRIMARY KEY NOT NULL,
	"step_id" text NOT NULL,
	"server_id" text NOT NULL,
	"stdout" text,
	"stderr" text,
	"exit_code" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "execution_step" (
	"id" text PRIMARY KEY NOT NULL,
	"execution_id" text NOT NULL,
	"step_number" integer NOT NULL,
	"phase" text NOT NULL,
	"step_name" text NOT NULL,
	"target_role" text NOT NULL,
	"status" "step_status" DEFAULT 'pending' NOT NULL,
	"command_template" text,
	"resolved_command" text,
	"started_at" timestamp,
	"completed_at" timestamp,
	"error_message" text
);
--> statement-breakpoint
CREATE TABLE "execution" (
	"id" text PRIMARY KEY NOT NULL,
	"cluster_id" text NOT NULL,
	"status" "execution_status" DEFAULT 'running' NOT NULL,
	"current_phase" text,
	"current_step" text,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "server" (
	"id" text PRIMARY KEY NOT NULL,
	"cluster_id" text NOT NULL,
	"hostname" text,
	"ip_address" text NOT NULL,
	"ssh_port" integer DEFAULT 22 NOT NULL,
	"ssh_user" text DEFAULT 'root' NOT NULL,
	"ssh_private_key" text,
	"ssh_key_id" text,
	"role" "server_role" NOT NULL,
	"hetzner_server_id" text,
	"private_ip_address" text,
	"status" "server_status" DEFAULT 'pending' NOT NULL,
	"cached_hostname" text,
	"cached_os" text,
	"cached_arch" text,
	"cached_cpu_cores" integer,
	"cached_ram_mb" integer,
	"cached_kernel" text,
	"cached_uptime" text,
	"cached_timezone" text,
	"cached_disk_total" text,
	"cached_disk_used" text,
	"cached_disk_free" text,
	"cached_disk_percent" text,
	"last_fetched_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ssh_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"hetzner_key_id" text,
	"public_key" text NOT NULL,
	"private_key" text,
	"fingerprint" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ssh_keys_hetzner_key_id_unique" UNIQUE("hetzner_key_id")
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_log" ADD CONSTRAINT "execution_log_step_id_execution_step_id_fk" FOREIGN KEY ("step_id") REFERENCES "public"."execution_step"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_log" ADD CONSTRAINT "execution_log_server_id_server_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."server"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_step" ADD CONSTRAINT "execution_step_execution_id_execution_id_fk" FOREIGN KEY ("execution_id") REFERENCES "public"."execution"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution" ADD CONSTRAINT "execution_cluster_id_cluster_id_fk" FOREIGN KEY ("cluster_id") REFERENCES "public"."cluster"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "server" ADD CONSTRAINT "server_cluster_id_cluster_id_fk" FOREIGN KEY ("cluster_id") REFERENCES "public"."cluster"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "execution_log_step_id_idx" ON "execution_log" USING btree ("step_id");--> statement-breakpoint
CREATE INDEX "execution_log_server_id_idx" ON "execution_log" USING btree ("server_id");--> statement-breakpoint
CREATE INDEX "execution_step_execution_id_idx" ON "execution_step" USING btree ("execution_id");--> statement-breakpoint
CREATE INDEX "execution_cluster_id_idx" ON "execution" USING btree ("cluster_id");--> statement-breakpoint
CREATE INDEX "server_cluster_id_idx" ON "server" USING btree ("cluster_id");--> statement-breakpoint
CREATE INDEX "server_role_idx" ON "server" USING btree ("role");