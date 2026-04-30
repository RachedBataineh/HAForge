import { describe, it, expect, vi } from "vitest";

// Mock the env module before importing crypto (which depends on it)
vi.mock("@HAForge/env/server", () => ({
  env: {
    SECRET_ENCRYPTION_KEY: "a".repeat(64),
  },
}));

import { generatePassword } from "../../services/server-info";
import { encrypt, decrypt, isEncrypted } from "../../services/crypto";

describe("generatePassword", () => {
  it("generates a password of default length (32)", () => {
    const pw = generatePassword();
    expect(pw.length).toBe(32);
  });

  it("generates a password of custom length", () => {
    const pw = generatePassword(16);
    expect(pw.length).toBe(16);
  });

  it("only contains alphanumeric characters", () => {
    const pw = generatePassword(100);
    expect(pw).toMatch(/^[a-zA-Z0-9]+$/);
  });

  it("generates unique passwords", () => {
    const passwords = new Set(Array.from({ length: 50 }, () => generatePassword()));
    expect(passwords.size).toBe(50);
  });

  it("contains at least some lowercase, uppercase, and digits", () => {
    const pw = generatePassword(100);
    expect(pw).toMatch(/[a-z]/);
    expect(pw).toMatch(/[A-Z]/);
    expect(pw).toMatch(/[0-9]/);
  });
});

describe("crypto (encrypt/decrypt)", () => {
  it("encrypts and decrypts a string correctly", () => {
    const original = "my-secret-api-token-12345";
    const encrypted = encrypt(original);
    expect(encrypted).not.toBe(original);
    expect(encrypted.startsWith("enc:v1:")).toBe(true);
    expect(decrypt(encrypted)).toBe(original);
  });

  it("isEncrypted detects encrypted values", () => {
    expect(isEncrypted("enc:v1:abc:def:123")).toBe(true);
    expect(isEncrypted("plain-text")).toBe(false);
    expect(isEncrypted(null)).toBe(false);
    expect(isEncrypted(undefined)).toBe(false);
  });

  it("decrypt returns plaintext for non-encrypted values (lazy migration)", () => {
    expect(decrypt("not-encrypted")).toBe("not-encrypted");
  });

  it("produces different ciphertexts for same plaintext", () => {
    const encrypted1 = encrypt("same-value");
    const encrypted2 = encrypt("same-value");
    expect(encrypted1).not.toBe(encrypted2); // different IVs
    expect(decrypt(encrypted1)).toBe("same-value");
    expect(decrypt(encrypted2)).toBe("same-value");
  });
});
