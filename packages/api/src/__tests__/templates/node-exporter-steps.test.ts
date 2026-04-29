import { describe, it, expect } from "vitest";
import { getMonitoringSteps } from "../../templates/monitoring/node-exporter-steps";

describe("getMonitoringSteps", () => {
  const steps = getMonitoringSteps();

  it("returns 3 steps", () => {
    expect(steps).toHaveLength(3);
  });

  it("all steps have phase 'monitoring'", () => {
    for (const step of steps) {
      expect(step.phase).toBe("monitoring");
    }
  });

  it("all steps target 'all' servers", () => {
    for (const step of steps) {
      expect(step.targetRole).toBe("all");
    }
  });

  it("step numbers are sequential starting from 1", () => {
    expect(steps[0].stepNumber).toBe(1);
    expect(steps[1].stepNumber).toBe(2);
    expect(steps[2].stepNumber).toBe(3);
  });

  it("step 1 downloads the binary", () => {
    expect(steps[0].name).toBe("Download Node Exporter");
    expect(steps[0].commands[0].commands.length).toBeGreaterThan(0);
    expect(steps[0].files).toEqual([]);
    expect(steps[0].validation).toBeTruthy();
  });

  it("step 2 creates a systemd service file", () => {
    expect(steps[1].name).toBe("Create Node Exporter Service");
    expect(steps[1].files).toHaveLength(1);
    expect(steps[1].files[0].path).toBe("/etc/systemd/system/node_exporter.service");
    expect(steps[1].files[0].content).toContain("User=node_exporter");
    expect(steps[1].files[0].content).toContain("ExecStart=/usr/local/bin/node_exporter");
  });

  it("step 3 starts and validates the service", () => {
    expect(steps[2].name).toBe("Start Node Exporter");
    expect(steps[2].commands[0].commands).toContain("sudo systemctl enable node_exporter");
    expect(steps[2].commands[0].commands).toContain("sudo systemctl start node_exporter");
    expect(steps[2].validation).toContain("localhost:9100");
  });

  it("service file does not contain any credentials", () => {
    const serviceFile = steps[1].files[0].content;
    expect(serviceFile).not.toContain("password");
    expect(serviceFile).not.toContain("PASSWORD");
    expect(serviceFile).not.toContain("token");
    expect(serviceFile).not.toContain("Environment=DATA_SOURCE");
  });

  it("uses a locked-down system user", () => {
    const createUserCmd = steps[1].commands[0].commands[0];
    expect(createUserCmd).toContain("--no-create-home");
    expect(createUserCmd).toContain("/usr/sbin/nologin");
  });

  it("download URL uses HTTPS and is valid", () => {
    const downloadCmd = steps[0].commands[0].commands[0];
    expect(downloadCmd).toContain("https://github.com/prometheus/node_exporter/releases");
    expect(downloadCmd).toContain("linux-amd64.tar.gz");
  });
});
