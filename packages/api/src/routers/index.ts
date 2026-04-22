import { protectedProcedure, publicProcedure, router } from "../index";
import { clusterRouter } from "./cluster";
import { serverRouter } from "./server";
import { executionRouter } from "./execution";
import { settingsRouter } from "./settings";
import { networkRouter } from "./network";

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
  settings: settingsRouter,
  network: networkRouter,
});
export type AppRouter = typeof appRouter;
