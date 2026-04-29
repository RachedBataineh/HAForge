import type { PatchDefinition } from "./types";

// =============================================================================
// Patch Registry
// =============================================================================
// Patches are ordered by ID. Each patch is a targeted fix applied to running
// servers. They are bundled in HAForge and delivered with app updates.
//
// To add a new patch:
// 1. Create a new file: NNN-description.ts
// 2. Export a PatchDefinition with the exact commands to fix the issue
// 3. Import and add it to ALL_PATCHES below
//
// Rules:
// - Patches must be IDEMPOTENT (safe to run more than once)
// - Patches must be MINIMAL (only fix what changed, don't re-run original steps)
// - targetRole controls which servers the patch runs on
// =============================================================================

export const ALL_PATCHES: PatchDefinition[] = [
  // Add patches here as needed, e.g.:
  // fixPatroniTimeoutPatch,
  // updateNodeExporterPatch,
];
