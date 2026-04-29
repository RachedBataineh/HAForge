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
import { db, sshKeys, clusters } from "@HAForge/db";
import { servers } from "@HAForge/db";
import { eq } from "drizzle-orm";

// --- In-memory rate limiter ---
const rateLimitStore = new Map<string, { count: number; resetAt: number }>();

function getClientIp(c: any): string {
  const forwarded = c.req.header("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  const realIp = c.req.header("x-real-ip");
  if (realIp) return realIp.trim();
  return "unknown";
}

function rateLimiter(options: { windowMs: number; max: number }) {
  return async (c: any, next: any) => {
    if (env.NODE_ENV !== "production") {
      return next();
    }
    const ip = getClientIp(c);
    const now = Date.now();
    const entry = rateLimitStore.get(ip);

    if (!entry || now > entry.resetAt) {
      rateLimitStore.set(ip, { count: 1, resetAt: now + options.windowMs });
      return next();
    }

    entry.count++;
    if (entry.count > options.max) {
      return c.json(
        { error: { message: "Too many requests. Please try again later." } },
        429,
        { "Retry-After": String(Math.ceil((entry.resetAt - now) / 1000)) },
      );
    }

    return next();
  };
}
// --- End rate limiter ---

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

// Rate limit auth and API routes (Better Auth has its own internal rate limiting too)
app.use("/api/auth/*", rateLimiter({ windowMs: 60_000, max: 120 }));
app.use("/trpc/*", rateLimiter({ windowMs: 60_000, max: 120 }));

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
  upgradeWebSocket(async (c) => {
    // Authenticate WebSocket connection via session cookie
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) {
      return {
        onOpen(_event: any, ws: any) {
          ws.send(JSON.stringify({ type: "error", message: "Authentication required" }));
          ws.close();
        },
      };
    }

    const url = new URL(c.req.url, `http://${c.req.header("host")}`);
    const serverId = url.searchParams.get("serverId");

    if (!serverId) {
      return {
        onOpen(_event: any, ws: any) {
          ws.send(JSON.stringify({ type: "error", message: "Missing serverId" }));
          ws.close();
        },
      };
    }

    return {
      onOpen(_event: any, ws: any) {

        const ssh = new Client();
        (ws as any).__ssh = ssh;

        ssh
          .on("ready", () => {
            (ssh as any).windowChanged = (_rows: number, _cols: number) => {
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

            // Ownership check — only the server's owner can open a terminal
            const ownerId = server.userId;
            if (ownerId && ownerId !== session.user.id) {
              ws.send(JSON.stringify({ type: "error", message: "Access denied." }));
              ws.close();
              return;
            }
            if (!ownerId && server.clusterId) {
              const cluster = await db.query.clusters.findFirst({
                where: eq(clusters.id, server.clusterId),
              });
              if (cluster && cluster.userId !== session.user.id) {
                ws.send(JSON.stringify({ type: "error", message: "Access denied." }));
                ws.close();
                return;
              }
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
      onMessage(event: any, ws: any) {
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
      onClose(_event: any, ws: any) {
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
