import { createContext } from "@HAForge/api/context";
import { appRouter } from "@HAForge/api/routers/index";
import { auth } from "@HAForge/auth";
import { env } from "@HAForge/env/server";
import { trpcServer } from "@hono/trpc-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { createNodeWebSocket } from "@hono/node-ws";
import { Client } from "ssh2";
import { db, sshKeys } from "@HAForge/db";
import { servers } from "@HAForge/db";
import { eq } from "drizzle-orm";

const app = new Hono();

const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

app.use(logger());
app.use(
  "/*",
  cors({
    origin: env.CORS_ORIGIN,
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  }),
);

app.on(["POST", "GET"], "/api/auth/*", (c) => auth.handler(c.req.raw));

app.use(
  "/trpc/*",
  trpcServer({
    router: appRouter,
    createContext: (_opts, context) => {
      return createContext({ context });
    },
  }),
);

app.get("/", (c) => {
  return c.text("OK");
});

// WebSocket terminal endpoint
app.get(
  "/ws/terminal",
  upgradeWebSocket((c) => {
    return {
      onOpen(event, ws) {
        const url = new URL(c.req.url, `http://${c.req.header("host")}`);
        const serverId = url.searchParams.get("serverId");

        if (!serverId) {
          ws.send(JSON.stringify({ type: "error", message: "Missing serverId" }));
          ws.close();
          return;
        }

        const ssh = new Client();
        (ws as any).__ssh = ssh;

        ssh
          .on("ready", () => {
            ssh.windowChanged = (rows: number, cols: number) => {
              // Will be set up below
            };
            ssh.shell(
              {
                term: "xterm-256color",
                cols: 80,
                rows: 24,
              },
              (err, stream) => {
                if (err) {
                  ws.send(JSON.stringify({ type: "error", message: err.message }));
                  ws.close();
                  return;
                }

                (ws as any).__stream = stream;

                stream.on("data", (data: Buffer) => {
                  ws.send(data.toString("utf-8"));
                });

                stream.stderr.on("data", (data: Buffer) => {
                  ws.send(data.toString("utf-8"));
                });

                stream.on("close", () => {
                  ws.close();
                });

                ws.send(JSON.stringify({ type: "connected" }));
              },
            );
          })
          .on("error", (err) => {
            ws.send(JSON.stringify({ type: "error", message: `SSH error: ${err.message}` }));
            ws.close();
          })
          .on("close", () => {
            ws.close();
          });

        // Fetch server from DB and connect
        (async () => {
          try {
            let server: any = null;

            if (serverId.startsWith("hetzner-")) {
              const hetznerId = serverId.replace("hetzner-", "");
              server = await db.query.servers.findFirst({
                where: eq(servers.hetznerServerId, hetznerId),
              });
            } else {
              server = await db.query.servers.findFirst({
                where: eq(servers.id, serverId),
              });
            }

            if (!server) {
              ws.send(JSON.stringify({ type: "error", message: "Server not found. Assign an SSH key first." }));
              ws.close();
              return;
            }

            // Resolve private key from ssh_keys table via sshKeyId
            let privateKey: string | null = null;
            if (server.sshKeyId) {
              const key = await db.query.sshKeys.findFirst({
                where: eq(sshKeys.id, server.sshKeyId),
              });
              privateKey = key?.privateKey || null;
            }

            if (!privateKey) {
              ws.send(JSON.stringify({ type: "error", message: "No SSH private key. Assign an SSH key first." }));
              ws.close();
              return;
            }

            if (!server.ipAddress) {
              ws.send(JSON.stringify({ type: "error", message: "No IP address configured for this server." }));
              ws.close();
              return;
            }

            ssh.connect({
              host: server.ipAddress,
              port: server.sshPort || 22,
              username: server.sshUser || "root",
              privateKey,
              readyTimeout: 10000,
            });
          } catch (err: any) {
            ws.send(JSON.stringify({ type: "error", message: err.message }));
            ws.close();
          }
        })();
      },
      onMessage(event, ws) {
        const stream = (ws as any).__stream;
        if (!stream) return;

        const msg = event.data;
        if (typeof msg === "string") {
          try {
            const parsed = JSON.parse(msg);
            if (parsed.type === "resize" && parsed.cols && parsed.rows) {
              stream.setWindow(parsed.rows, parsed.cols, 0, 0);
              return;
            }
          } catch {
            // Not JSON — treat as raw input
          }
          stream.write(msg);
        }
      },
      onClose() {
        const ssh = (ws as any).__ssh;
        const stream = (ws as any).__stream;
        if (stream) stream.close();
        if (ssh) ssh.end();
      },
    };
  }),
);

import { serve } from "@hono/node-server";

const server = serve(
  {
    fetch: app.fetch,
    port: 3000,
  },
  (info) => {
    console.log(`Server is running on http://localhost:${info.port}`);
  },
);

injectWebSocket(server);
