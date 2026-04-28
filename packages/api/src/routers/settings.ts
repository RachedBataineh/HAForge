import { db } from "@HAForge/db";
import { user, account } from "@HAForge/db";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, router } from "../index";
import bcrypt from "bcryptjs";

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
