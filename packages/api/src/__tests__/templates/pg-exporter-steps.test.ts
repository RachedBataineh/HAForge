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
    expect(steps[0].stepNumber).toBe(1);
    expect(steps[1].stepNumber).toBe(2);
    expect(steps[2].stepNumber).toBe(3);
    expect(steps[3].stepNumber).toBe(4);
  });

  describe("step 1: Create PG Monitoring User", () => {
    const step = steps[0];

    it("creates the system user with restricted shell", () => {
      const useraddCmd = step.commands[0].commands[0];
      expect(useraddCmd).toContain("postgres_exporter");
      expect(useraddCmd).toContain("--no-create-home");
      expect(useraddCmd).toContain("/usr/sbin/nologin");
    });

    it("creates PG role with IF NOT EXISTS guard", () => {
      const createRoleCmd = step.commands[0].commands[1];
      expect(createRoleCmd).toContain("postgres_exporter");
      expect(createRoleCmd).toContain("IF NOT EXISTS");
    });

    it("grants pg_monitor role", () => {
      const grantCmd = step.commands[0].commands[2];
      expect(grantCmd).toContain("GRANT pg_monitor");
      expect(grantCmd).toContain("postgres_exporter");
    });

    it("grants CONNECT on postgres database", () => {
      const connectCmd = step.commands[0].commands[3];
      expect(connectCmd).toContain("GRANT CONNECT");
      expect(connectCmd).toContain("postgres");
    });

    it("DDL commands tolerate failure on replicas", () => {
      for (let i = 1; i < step.commands[0].commands.length; i++) {
        expect(step.commands[0].commands[i]).toContain("|| true");
      }
    });
  });

  describe("step 2: Download binary", () => {
    const step = steps[1];

    it("downloads from GitHub releases", () => {
      expect(step.commands[0].commands[0]).toContain("https://github.com/prometheus-community/postgres_exporter/releases");
    });

    it("uses version 0.19.1", () => {
      expect(step.commands[0].commands[0]).toContain("0.19.1");
    });

    it("cleans up temp files", () => {
      const cleanupCmd = step.commands[0].commands[step.commands[0].commands.length - 1];
      expect(cleanupCmd).toContain("rm -rf");
    });
  });

  describe("step 3: Create service", () => {
    const step = steps[2];

    it("creates a systemd service file", () => {
      expect(step.files).toHaveLength(1);
      expect(step.files[0].path).toBe("/etc/systemd/system/postgres_exporter.service");
    });

    it("runs as postgres_exporter user", () => {
      expect(step.files[0].content).toContain("User=postgres_exporter");
      expect(step.files[0].content).toContain("Group=postgres_exporter");
    });

    it("connects via Unix socket (no TCP)", () => {
      const dsn = step.files[0].content;
      expect(dsn).toContain("host=/var/run/postgresql");
      expect(dsn).not.toContain("localhost");
      expect(dsn).not.toContain("127.0.0.1");
    });

    it("uses peer auth (no passwords)", () => {
      const content = step.files[0].content;
      expect(content).not.toContain("password");
      expect(content).not.toContain("PASSWORD");
      expect(content).not.toContain("DATA_SOURCE_PASS");
      expect(content).toContain("user=postgres_exporter");
    });

    it("does not use SSL (Unix socket is already local)", () => {
      expect(step.files[0].content).not.toContain("sslmode");
    });

    it("connects to postgres database", () => {
      expect(step.files[0].content).toContain("dbname=postgres");
    });

    it("listens on port 9187", () => {
      expect(step.files[0].content).toContain("9187");
    });
  });

  describe("step 4: Start service", () => {
    const step = steps[3];

    it("enables and starts the service", () => {
      const cmds = step.commands[0].commands;
      expect(cmds).toContain("sudo systemctl enable postgres_exporter");
      expect(cmds).toContain("sudo systemctl restart postgres_exporter");
    });

    it("validates metrics endpoint", () => {
      expect(step.validation).toContain("localhost:9187");
    });
  });
});
