import { describe, it, expect } from "vitest";
import { getPgExporterSteps } from "../../templates/monitoring/pg-exporter-steps";

describe("getPgExporterSteps", () => {
  const steps = getPgExporterSteps();

  it("returns 4 steps", () => {
    expect(steps).toHaveLength(4);
  });

  it("all steps have phase 'monitoring'", () => {
    for (const step of steps) {
      expect(step.phase).toBe("monitoring");
    }
  });

  it("all steps target 'all_pg' servers", () => {
    for (const step of steps) {
      expect(step.targetRole).toBe("all_pg");
    }
  });

  it("step numbers are sequential starting from 1", () => {
    expect(steps[0]!.stepNumber).toBe(1);
    expect(steps[1]!.stepNumber).toBe(2);
    expect(steps[2]!.stepNumber).toBe(3);
    expect(steps[3]!.stepNumber).toBe(4);
  });

  describe("step 1: Create PG Monitoring User", () => {
    const step = steps[0]!;
    const cmds = step.commands[0]!.commands;

    it("creates the system user with restricted shell", () => {
      const useraddCmd = cmds[0]!;
      expect(useraddCmd).toContain("postgres_exporter");
      expect(useraddCmd).toContain("--no-create-home");
      expect(useraddCmd).toContain("/usr/sbin/nologin");
    });

    it("creates PG role with IF NOT EXISTS guard", () => {
      const createRoleCmd = cmds[1]!;
      expect(createRoleCmd).toContain("postgres_exporter");
      expect(createRoleCmd).toContain("IF NOT EXISTS");
    });

    it("grants pg_monitor role", () => {
      const grantCmd = cmds[2]!;
      expect(grantCmd).toContain("GRANT pg_monitor");
      expect(grantCmd).toContain("postgres_exporter");
    });

    it("grants CONNECT on postgres database", () => {
      const connectCmd = cmds[3]!;
      expect(connectCmd).toContain("GRANT CONNECT");
      expect(connectCmd).toContain("postgres");
    });

    it("DDL commands tolerate failure on replicas", () => {
      for (let i = 1; i < cmds.length; i++) {
        expect(cmds[i]).toContain("|| true");
      }
    });
  });

  describe("step 2: Download binary", () => {
    const step = steps[1]!;
    const cmds = step.commands[0]!.commands;

    it("downloads from GitHub releases", () => {
      expect(cmds[0]!).toContain("https://github.com/prometheus-community/postgres_exporter/releases");
    });

    it("uses version 0.19.1", () => {
      expect(cmds[0]!).toContain("0.19.1");
    });

    it("cleans up temp files", () => {
      const cleanupCmd = cmds[cmds.length - 1];
      expect(cleanupCmd).toContain("rm -rf");
    });
  });

  describe("step 3: Create service", () => {
    const step = steps[2]!;
    const file = step.files[0]!;

    it("creates a systemd service file", () => {
      expect(step.files).toHaveLength(1);
      expect(file.path).toBe("/etc/systemd/system/postgres_exporter.service");
    });

    it("runs as postgres_exporter user", () => {
      expect(file.content).toContain("User=postgres_exporter");
      expect(file.content).toContain("Group=postgres_exporter");
    });

    it("connects via Unix socket (no TCP)", () => {
      const dsn = file.content;
      expect(dsn).toContain("host=/var/run/postgresql");
      expect(dsn).not.toContain("localhost");
      expect(dsn).not.toContain("127.0.0.1");
    });

    it("uses peer auth (no passwords)", () => {
      const content = file.content;
      expect(content).not.toContain("password");
      expect(content).not.toContain("PASSWORD");
      expect(content).not.toContain("DATA_SOURCE_PASS");
      expect(content).toContain("user=postgres_exporter");
    });

    it("does not use SSL (Unix socket is already local)", () => {
      expect(file.content).not.toContain("sslmode");
    });

    it("connects to postgres database", () => {
      expect(file.content).toContain("dbname=postgres");
    });

    it("listens on port 9187", () => {
      expect(file.content).toContain("9187");
    });
  });

  describe("step 4: Start service", () => {
    const step = steps[3]!;
    const cmds = step.commands[0]!.commands;

    it("enables and starts the service", () => {
      expect(cmds).toContain("sudo systemctl enable postgres_exporter");
      expect(cmds).toContain("sudo systemctl restart postgres_exporter");
    });

    it("validates metrics endpoint", () => {
      expect(step.validation).toContain("localhost:9187");
    });
  });
});
