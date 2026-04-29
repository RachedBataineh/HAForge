import { describe, it, expect } from "vitest";
import { getClusterSteps, getLbClusterSteps } from "../../templates/cluster-steps";

describe("getClusterSteps", () => {
  describe("with monitoring enabled", () => {
    const steps = getClusterSteps(true);

    it("returns steps from all phases", () => {
      const phases = [...new Set(steps.map((s) => s.phase))];
      expect(phases).toContain("hardening");
      expect(phases).toContain("postgres");
      expect(phases).toContain("haproxy");
      expect(phases).toContain("monitoring");
    });

    it("step numbers are sequential with no gaps or duplicates", () => {
      const numbers = steps.map((s) => s.stepNumber);
      for (let i = 0; i < numbers.length; i++) {
        expect(numbers[i]).toBe(i + 1);
      }
    });

    it("has monitoring steps targeting both 'all' and 'all_pg'", () => {
      const monitoringSteps = steps.filter((s) => s.phase === "monitoring");
      const allTargets = monitoringSteps.filter((s) => s.targetRole === "all");
      const pgTargets = monitoringSteps.filter((s) => s.targetRole === "all_pg");
      expect(allTargets.length).toBeGreaterThan(0); // node exporter
      expect(pgTargets.length).toBeGreaterThan(0); // pg exporter
    });

    it("orders phases correctly: hardening -> postgres -> haproxy -> monitoring", () => {
      const phases = steps.map((s) => s.phase);
      const hardeningEnd = phases.lastIndexOf("hardening");
      const pgStart = phases.indexOf("postgres");
      const pgEnd = phases.lastIndexOf("postgres");
      const haStart = phases.indexOf("haproxy");
      const haEnd = phases.lastIndexOf("haproxy");
      const monStart = phases.indexOf("monitoring");

      expect(hardeningEnd).toBeLessThan(pgStart);
      expect(pgEnd).toBeLessThan(haStart);
      expect(haEnd).toBeLessThan(monStart);
    });
  });

  describe("with monitoring disabled", () => {
    const steps = getClusterSteps(false);

    it("has no monitoring steps", () => {
      const phases = steps.map((s) => s.phase);
      expect(phases).not.toContain("monitoring");
    });

    it("still has hardening, postgres, and haproxy phases", () => {
      const phases = [...new Set(steps.map((s) => s.phase))];
      expect(phases).toContain("hardening");
      expect(phases).toContain("postgres");
      expect(phases).toContain("haproxy");
    });
  });
});

describe("getLbClusterSteps", () => {
  describe("with monitoring enabled", () => {
    const steps = getLbClusterSteps(true);

    it("has no haproxy phase (LB mode uses Hetzner LB)", () => {
      const phases = steps.map((s) => s.phase);
      expect(phases).not.toContain("haproxy");
    });

    it("has hardening, postgres, and monitoring phases", () => {
      const phases = [...new Set(steps.map((s) => s.phase))];
      expect(phases).toContain("hardening");
      expect(phases).toContain("postgres");
      expect(phases).toContain("monitoring");
    });

    it("step numbers are sequential", () => {
      const numbers = steps.map((s) => s.stepNumber);
      for (let i = 0; i < numbers.length; i++) {
        expect(numbers[i]).toBe(i + 1);
      }
    });
  });

  describe("with monitoring disabled", () => {
    const steps = getLbClusterSteps(false);

    it("has no monitoring steps", () => {
      const phases = steps.map((s) => s.phase);
      expect(phases).not.toContain("monitoring");
    });
  });
});
