import { db } from "@HAForge/db";
import { user, clusters, sshKeys, servers } from "@HAForge/db";
import { eq } from "drizzle-orm";
import { decrypt } from "../services/crypto";

export const HETZNER_API = "https://api.hetzner.cloud/v1";

export const hetznerHeaders = (token: string) => ({
  Authorization: `Bearer ${token}`,
  "Content-Type": "application/json",
});

export async function getUserApiToken(userId: string): Promise<string> {
  const u = await db.query.user.findFirst({ where: eq(user.id, userId) });
  if (!u?.hetznerApiToken) return "";
  try {
    return decrypt(u.hetznerApiToken);
  } catch {
    return u.hetznerApiToken; // Lazy migration fallback
  }
}

export function decryptPrivateKey(privateKey: string | null | undefined): string | null {
  if (!privateKey) return null;
  try {
    return decrypt(privateKey);
  } catch {
    return privateKey; // Lazy migration fallback
  }
}

export async function verifyServerOwnership(serverId: string, userId: string) {
  const server = await db.query.servers.findFirst({ where: eq(servers.id, serverId) });
  if (!server) throw new Error("Server not found");
  if (server.userId && server.userId !== userId) throw new Error("Access denied");
  if (!server.userId && server.clusterId) {
    const cluster = await db.query.clusters.findFirst({ where: eq(clusters.id, server.clusterId) });
    if (cluster && cluster.userId !== userId) throw new Error("Access denied");
  }
  return server;
}

export async function getServerSshKeyMaps(userId?: string) {
  const dbServerRecords = userId
    ? await db.query.servers.findMany({ where: eq(servers.userId, userId) })
    : await db.query.servers.findMany();
  const sshKeyMap = new Map<string, string | null>();
  const sshPrivateKeyMap = new Map<string, string | null>();
  for (const s of dbServerRecords) {
    if (s.hetznerServerId) {
      sshKeyMap.set(s.hetznerServerId, s.sshKeyId);
    }
  }
  const allSshKeys = userId
    ? await db.query.sshKeys.findMany({ where: eq(sshKeys.userId, userId) })
    : await db.query.sshKeys.findMany();
  const sshKeyNameMap = new Map<string, string>();
  for (const k of allSshKeys) {
    sshKeyNameMap.set(k.id, k.name);
  }
  for (const s of dbServerRecords) {
    if (s.hetznerServerId && s.sshKeyId) {
      const key = allSshKeys.find((k) => k.id === s.sshKeyId);
      if (key?.privateKey) {
        try {
          sshPrivateKeyMap.set(s.hetznerServerId, decrypt(key.privateKey));
        } catch {
          sshPrivateKeyMap.set(s.hetznerServerId, key.privateKey); // Lazy migration fallback
        }
      }
    }
  }
  return { sshKeyMap, sshKeyNameMap, sshPrivateKeyMap };
}
