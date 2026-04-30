import { relations } from "drizzle-orm";
import {
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { user } from "./auth";

export const clusterStatusEnum = pgEnum("cluster_status", [
  "draft",
  "deploying",
  "running",
  "error",
]);

export const clusterTypeEnum = pgEnum("cluster_type", [
  "haproxy",
  "hetzner_lb",
]);

export const provisioningModeEnum = pgEnum("provisioning_mode", [
  "manual",
  "automatic",
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
  "ready",
  "error",
]);

export const executionStatusEnum = pgEnum("execution_status", [
  "running",
  "completed",
  "failed",
  "cancelled",
]);

export const executionTypeEnum = pgEnum("execution_type", [
  "deploy",
  "patch",
]);

export const stepStatusEnum = pgEnum("step_status", [
  "pending",
  "running",
  "completed",
  "failed",
  "skipped",
]);

export const patchStatusEnum = pgEnum("patch_status", [
  "pending",
  "applying",
  "applied",
  "failed",
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
  floatingIpId: text("floating_ip_id"),
  loadBalancerId: text("load_balancer_id"),
  loadBalancerIp: text("load_balancer_ip"),
  networkId: text("network_id"),
  wizardStep: integer("wizard_step"),

  // Provisioning
  provisioningMode: provisioningModeEnum("provisioning_mode").default("manual"),

  // Auto-generated credentials
  superuserPassword: text("superuser_password"),
  replicationPassword: text("replication_password"),
  superuserUsername: text("superuser_username").default("postgres"),
  adminUsername: text("admin_username").default("haforge"),

  enableMonitoring: integer("enable_monitoring").default(1),

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
}, (table) => [
  index("cluster_user_id_idx").on(table.userId),
]);

export const servers = pgTable(
  "server",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id"),
    clusterId: text("cluster_id")
      .references(() => clusters.id, { onDelete: "cascade" }),

    hostname: text("hostname"),
    ipAddress: text("ip_address"),
    sshPort: integer("ssh_port").default(22).notNull(),
    sshUser: text("ssh_user").default("root").notNull(),
    sshKeyId: text("ssh_key_id")
      .references(() => sshKeys.id),

    role: serverRoleEnum("role").notNull(),
    hetznerServerId: text("hetzner_server_id"),
    privateIpAddress: text("private_ip_address"),
    status: serverStatusEnum("status").default("pending").notNull(),

    // Cached server info (fetched via SSH)
    cachedHostname: text("cached_hostname"),
    cachedOs: text("cached_os"),
    cachedArch: text("cached_arch"),
    cachedCpuCores: integer("cached_cpu_cores"),
    cachedRamMB: integer("cached_ram_mb"),
    cachedKernel: text("cached_kernel"),
    cachedUptime: text("cached_uptime"),
    cachedTimezone: text("cached_timezone"),
    cachedDiskTotal: text("cached_disk_total"),
    cachedDiskUsed: text("cached_disk_used"),
    cachedDiskFree: text("cached_disk_free"),
    cachedDiskPercent: text("cached_disk_percent"),
    lastFetchedAt: timestamp("last_fetched_at"),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("server_cluster_id_idx").on(table.clusterId),
    index("server_role_idx").on(table.role),
    index("server_hetzner_server_id_idx").on(table.hetznerServerId),
    index("server_ssh_key_id_idx").on(table.sshKeyId),
    index("server_user_id_idx").on(table.userId),
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
    executionType: executionTypeEnum("execution_type").default("deploy").notNull(),
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
    phase: text("phase").notNull(),
    stepName: text("step_name").notNull(),
    targetRole: text("target_role").notNull(),

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
export const serverRelations = relations(servers, ({ one, many }) => ({
  cluster: one(clusters, {
    fields: [servers.clusterId],
    references: [clusters.id],
  }),
  sshKey: one(sshKeys, {
    fields: [servers.sshKeyId],
    references: [sshKeys.id],
  }),
  executionLogs: many(executionLogs),
}));

export const clusterPatches = pgTable(
  "cluster_patch",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    clusterId: text("cluster_id")
      .notNull()
      .references(() => clusters.id, { onDelete: "cascade" }),
    patchId: text("patch_id").notNull(),
    status: patchStatusEnum("status").default("pending").notNull(),
    appliedAt: timestamp("applied_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("cluster_patch_cluster_id_idx").on(table.clusterId),
    index("cluster_patch_patch_id_idx").on(table.patchId),
  ],
);

export const clusterRelations = relations(clusters, ({ many }) => ({
  servers: many(servers),
  executions: many(executions),
  patches: many(clusterPatches),
}));

export const clusterPatchRelations = relations(clusterPatches, ({ one }) => ({
  cluster: one(clusters, {
    fields: [clusterPatches.clusterId],
    references: [clusters.id],
  }),
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

export const sshKeys = pgTable("ssh_keys", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id").notNull(),
  name: text("name").notNull(),
  hetznerKeyId: text("hetzner_key_id").unique(),
  publicKey: text("public_key").notNull(),
  privateKey: text("private_key"),
  fingerprint: text("fingerprint"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("ssh_keys_user_id_idx").on(table.userId),
]);

export const sshKeyRelations = relations(sshKeys, ({ one, many }) => ({
  user: one(user, {
    fields: [sshKeys.userId],
    references: [user.id],
  }),
  servers: many(servers),
}));


