import { protectedProcedure, publicProcedure, router } from "../index";
import { clusterRouter } from "./cluster";
import { serverRouter } from "./server";
import { executionRouter } from "./execution";
import { settingsRouter } from "./settings";
import { networkRouter } from "./network";
import { floatingIpRouter } from "./floating-ip";
import { backupRouter } from "./backup";

export const appRouter = router({
  healthCheck: publicProcedure.query(() => {
    return "OK";
  }),
  cluster: clusterRouter,
  server: serverRouter,
  execution: executionRouter,
  settings: settingsRouter,
  network: networkRouter,
  floatingIp: floatingIpRouter,
  backup: backupRouter,
});
export type AppRouter = typeof appRouter;
