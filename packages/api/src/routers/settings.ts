import { db } from "@HAForge/db";
import { user, account } from "@HAForge/db";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, router } from "../index";
import bcrypt from "bcryptjs";
import crypto from "crypto";

const ENCRYPTION_KEY = process.env.S3_CREDENTIAL_ENCRYPTION_KEY || "";

function getEncryptionKey(): Buffer | null {
  if (!ENCRYPTION_KEY) return null;
  return Buffer.from(ENCRYPTION_KEY.padEnd(32).slice(0, 32), "utf8");
}

function encryptField(text: string): string {
  const key = getEncryptionKey();
  if (!key) return text;
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");
  return iv.toString("hex") + ":" + encrypted;
}

function decryptField(encrypted: string): string {
  const key = getEncryptionKey();
  if (!key) return encrypted;
  if (!encrypted.includes(":")) return encrypted;
  const parts = encrypted.split(":");
  const iv = Buffer.from(parts[0]!, "hex");
  const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
  let decrypted = decipher.update(parts[1]!, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

export async function getUserS3Config(userId: string) {
  const u = await db.query.user.findFirst({ where: eq(user.id, userId) });
  if (!u?.s3Endpoint || !u?.s3AccessKey || !u?.s3SecretKey) return null;
  return {
    s3Endpoint: u.s3Endpoint,
    s3Region: u.s3Region || "us-east-1",
    s3AccessKey: decryptField(u.s3AccessKey),
    s3SecretKey: decryptField(u.s3SecretKey),
  };
}

export const settingsRouter = router({
  getProfile: protectedProcedure.query(async ({ ctx }) => {
    const u = await db.query.user.findFirst({
      where: eq(user.id, ctx.session.user.id),
    });
    if (!u) throw new Error("User not found");
    return {
      id: u.id,
      name: u.name,
      email: u.email,
      image: u.image,
      hetznerApiToken: u.hetznerApiToken || "",
      s3Endpoint: u.s3Endpoint || "",
      s3Region: u.s3Region || "",
      s3AccessKey: u.s3AccessKey ? "••••••••" : "",
      s3SecretKey: u.s3SecretKey ? "••••••••" : "",
    };
  }),

  updateProfile: protectedProcedure
    .input(z.object({
      name: z.string().min(1),
    }))
    .mutation(async ({ input, ctx }) => {
      await db.update(user)
        .set({ name: input.name })
        .where(eq(user.id, ctx.session.user.id));
      return { success: true };
    }),

  updateHetznerToken: protectedProcedure
    .input(z.object({
      hetznerApiToken: z.string(),
    }))
    .mutation(async ({ input, ctx }) => {
      if (input.hetznerApiToken) {
        const existing = await db.query.user.findFirst({
          where: eq(user.hetznerApiToken, input.hetznerApiToken),
        });
        if (existing && existing.id !== ctx.session.user.id) {
          throw new Error("This Hetzner API token is already registered to another account.");
        }
      }
      await db.update(user)
        .set({ hetznerApiToken: input.hetznerApiToken || null })
        .where(eq(user.id, ctx.session.user.id));
      return { success: true };
    }),

  updateS3Config: protectedProcedure
    .input(z.object({
      s3Endpoint: z.string(),
      s3Region: z.string(),
      s3AccessKey: z.string(),
      s3SecretKey: z.string(),
    }))
    .mutation(async ({ input, ctx }) => {
      const existing = await db.query.user.findFirst({
        where: eq(user.id, ctx.session.user.id),
      });
      if (!existing) throw new Error("User not found");

      let accessKey = input.s3AccessKey;
      let secretKey = input.s3SecretKey;

      // If user didn't change the masked values, keep existing encrypted values
      if (accessKey === "••••••••" && existing.s3AccessKey) {
        accessKey = existing.s3AccessKey; // already encrypted in DB
      } else if (accessKey) {
        accessKey = encryptField(accessKey);
      }

      if (secretKey === "••••••••" && existing.s3SecretKey) {
        secretKey = existing.s3SecretKey; // already encrypted in DB
      } else if (secretKey) {
        secretKey = encryptField(secretKey);
      }

      await db.update(user).set({
        s3Endpoint: input.s3Endpoint || null,
        s3Region: input.s3Region || null,
        s3AccessKey: (input.s3Endpoint && input.s3AccessKey) ? accessKey : null,
        s3SecretKey: (input.s3Endpoint && input.s3AccessKey) ? secretKey : null,
      }).where(eq(user.id, ctx.session.user.id));
      return { success: true };
    }),

  changePassword: protectedProcedure
    .input(z.object({
      currentPassword: z.string(),
      newPassword: z.string().min(8),
    }))
    .mutation(async ({ input, ctx }) => {
      const accounts = await db.query.account.findMany({
        where: (a, { eq }) => eq(a.userId, ctx.session.user.id),
      });
      const credentialAccount = accounts.find((a) => a.providerId === "credential" && a.password);
      if (!credentialAccount) {
        throw new Error("No password account found. You may have signed in with a social provider.");
      }

      const valid = await bcrypt.compare(input.currentPassword, credentialAccount.password!);
      if (!valid) {
        throw new Error("Current password is incorrect");
      }

      const hashed = await bcrypt.hash(input.newPassword, 10);
      await db.update(account)
        .set({ password: hashed })
        .where(eq(account.id, credentialAccount.id));

      return { success: true };
    }),
});
