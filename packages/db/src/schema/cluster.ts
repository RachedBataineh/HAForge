import { relations } from "drizzle-orm";
import {
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

export const clusterStatusEnum = pgEnum("cluster_status", [
  "draft",
  "configuring",
  "deploying",
  "running",
  "error",
  "destroyed",
]);

export const clusterTypeEnum = pgEnum("cluster_type", [
  "haproxy",
  "hetzner_lb",
]);

export const serverRoleEnum = pgEnum("server_role", [
  "postgresql_1",
  "postgresql_2",
  "postgresql_3",
  "haproxy_1",
  "haproxy_2",
  "haproxy_3",
]);

export const serverStatusEnum = pgEnum("server_status", [
  "pending",
  "connecting",
  "installing",
  "configuring",
  "ready",
  "error",
]);

export const executionStatusEnum = pgEnum("execution_status", [
  "running",
  "completed",
  "failed",
  "cancelled",
]);

export const stepStatusEnum = pgEnum("step_status", [
  "pending",
  "running",
  "completed",
  "failed",
  "skipped",
]);

export const clusters = pgTable("cluster", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),
  status: clusterStatusEnum("status").default("draft").notNull(),
  clusterType: clusterTypeEnum("cluster_type").default("haproxy").notNull(),
  userId: text("user_id").notNull(),

  // Hetzner config
  floatingIp: text("floating_ip"),
  hetznerApiToken: text("hetzner_api_token"),
  floatingIpId: text("floating_ip_id"),
  loadBalancerId: text("load_balancer_id"),
  loadBalancerIp: text("load_balancer_ip"),
  wizardStep: integer("wizard_step"),

  // Auto-generated credentials (stored encrypted at app level)
  superuserPassword: text("superuser_password"),
  replicationPassword: text("replication_password"),

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

export const servers = pgTable(
  "server",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    clusterId: text("cluster_id")
      .notNull()
      .references(() => clusters.id, { onDelete: "cascade" }),

    hostname: text("hostname"),
    ipAddress: text("ip_address").notNull(),
    sshPort: integer("ssh_port").default(22).notNull(),
    sshUser: text("ssh_user").default("root").notNull(),
    sshPrivateKey: text("ssh_private_key").notNull(),

    role: serverRoleEnum("role").notNull(),
    hetznerServerId: text("hetzner_server_id"),
    privateIpAddress: text("private_ip_address"),
    status: serverStatusEnum("status").default("pending").notNull(),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("server_cluster_id_idx").on(table.clusterId),
    index("server_role_idx").on(table.role),
  ],
);

export const executions = pgTable(
  "execution",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    clusterId: text("cluster_id")
      .notNull()
      .references(() => clusters.id, { onDelete: "cascade" }),

    status: executionStatusEnum("status").default("running").notNull(),
    currentPhase: text("current_phase"),
    currentStep: text("current_step"),

    startedAt: timestamp("started_at").defaultNow().notNull(),
    completedAt: timestamp("completed_at"),
  },
  (table) => [index("execution_cluster_id_idx").on(table.clusterId)],
);

export const executionSteps = pgTable(
  "execution_step",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    executionId: text("execution_id")
      .notNull()
      .references(() => executions.id, { onDelete: "cascade" }),

    stepNumber: integer("step_number").notNull(),
    phase: text("phase").notNull(), // "postgres" or "haproxy"
    stepName: text("step_name").notNull(),
    targetRole: text("target_role").notNull(), // "all_pg", "all_ha", "postgresql_1", etc.

    status: stepStatusEnum("status").default("pending").notNull(),
    commandTemplate: text("command_template"),
    resolvedCommand: text("resolved_command"),

    startedAt: timestamp("started_at"),
    completedAt: timestamp("completed_at"),
    errorMessage: text("error_message"),
  },
  (table) => [index("execution_step_execution_id_idx").on(table.executionId)],
);

export const executionLogs = pgTable(
  "execution_log",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    stepId: text("step_id")
      .notNull()
      .references(() => executionSteps.id, { onDelete: "cascade" }),
    serverId: text("server_id")
      .notNull()
      .references(() => servers.id, { onDelete: "cascade" }),

    stdout: text("stdout"),
    stderr: text("stderr"),
    exitCode: integer("exit_code"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("execution_log_step_id_idx").on(table.stepId),
    index("execution_log_server_id_idx").on(table.serverId),
  ],
);

// Relations
export const clusterRelations = relations(clusters, ({ many }) => ({
  servers: many(servers),
  executions: many(executions),
}));

export const serverRelations = relations(servers, ({ one, many }) => ({
  cluster: one(clusters, {
    fields: [servers.clusterId],
    references: [clusters.id],
  }),
  executionLogs: many(executionLogs),
}));

export const executionRelations = relations(executions, ({ one, many }) => ({
  cluster: one(clusters, {
    fields: [executions.clusterId],
    references: [clusters.id],
  }),
  steps: many(executionSteps),
}));

export const executionStepRelations = relations(executionSteps, ({ one, many }) => ({
  execution: one(executions, {
    fields: [executionSteps.executionId],
    references: [executions.id],
  }),
  logs: many(executionLogs),
}));

export const executionLogRelations = relations(executionLogs, ({ one }) => ({
  step: one(executionSteps, {
    fields: [executionLogs.stepId],
    references: [executionSteps.id],
  }),
  server: one(servers, {
    fields: [executionLogs.serverId],
    references: [servers.id],
  }),
}));
