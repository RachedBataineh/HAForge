import { initTRPC } from "@trpc/server";

const t = initTRPC.context<Context>().create();
const createCallerFactory = t.createCallerFactory;

export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.session) {
    throw new Error("Authentication required");
  }
  return next({
    ctx: {
      ...ctx,
      session: ctx.session,
    },
  });
});

export const publicProcedure = t.procedure;
export const router = t.router;

interface Session {
  user: { id: string; name: string; email: string };
  session: { id: string; userId: string };
}

export type Context = {
  session: Session | null;
};

export function createCallerForRouter<R extends Record<string, any>>(routerDef: R, userId = "test-user-1") {
  const session: Session = {
    user: { id: userId, name: "Test User", email: "test@test.com" },
    session: { id: "session-1", userId },
  };

  const context: Context = { session };
  const appRouter = router(routerDef);
  return createCallerFactory(appRouter)(context) as any;
}

export function createUnauthenticatedCallerForRouter<R extends Record<string, any>>(routerDef: R) {
  const context: Context = { session: null };
  const appRouter = router(routerDef);
  return createCallerFactory(appRouter)(context) as any;
}
