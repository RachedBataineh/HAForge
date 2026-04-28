import { publicProcedure, router } from "../index";
import { clusterRouter } from "./cluster";
import { serverRouter } from "./server";
import { executionRouter } from "./execution";
import { settingsRouter } from "./settings";
import { networkRouter } from "./network";
import { floatingIpRouter } from "./floating-ip";
import { firewallRouter } from "./firewall";

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
  firewall: firewallRouter,
});
export type AppRouter = typeof appRouter;
