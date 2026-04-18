import { protectedProcedure, publicProcedure, router } from "../index";
import { clusterRouter } from "./cluster";
import { serverRouter } from "./server";
import { executionRouter } from "./execution";

export const appRouter = router({
  healthCheck: publicProcedure.query(() => {
    return "OK";
  }),
  privateData: protectedProcedure.query(({ ctx }) => {
    return {
      message: "This is private",
      user: ctx.session.user,
    };
  }),
  cluster: clusterRouter,
  server: serverRouter,
  execution: executionRouter,
});
export type AppRouter = typeof appRouter;
