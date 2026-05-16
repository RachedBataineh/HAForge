# HAForge

# Warning this app is not ready for production, use it at your own risk. This app has also been archived.

Web-based platform for provisioning and managing high-availability PostgreSQL clusters on Hetzner Cloud. Automates the deployment of Patroni-based PostgreSQL replication with HAProxy load balancing, monitoring, and server hardening through a guided wizard.

## Architecture

```
                  ┌─────────────────────┐
                  │   Next.js Web App   │  :3001
                  │   (Dashboard UI)    │
                  └─────────┬───────────┘
                            │ tRPC / WebSocket
                  ┌─────────▼───────────┐
                  │   Hono API Server   │  :3000
                  │   (tRPC, Auth, WS)  │
                  └─────────┬───────────┘
                            │
              ┌─────────────┼─────────────┐
              │             │             │
     ┌────────▼───┐  ┌─────▼─────┐  ┌───▼────────┐
     │ PostgreSQL │  │  Drizzle  │  │  Hetzner   │
     │            │  │    ORM    │  │ Cloud API  │
     └────────────┘  └───────────┘  └────────────┘
```

Monorepo built with Turborepo. The backend bundles all shared packages into a single file via tsdown, while the frontend uses Next.js standalone output for minimal Docker images.

## Features

- **Cluster Wizard** -- Step-by-step guided creation of HA PostgreSQL clusters
- **Two Cluster Types** -- HAProxy (3 Postgres + 3 HAProxy + Keepalived VIP) or Hetzner Load Balancer
- **Automated Provisioning** -- SSH-based orchestration that installs and configures Patroni, etcd, HAProxy, PostgreSQL, and monitoring agents
- **Manual Provisioning** -- Generate ready-to-run commands for each server role
- **Live Terminal** -- Browser-based SSH terminal via WebSocket (xterm.js)
- **Live Deployment Logs** -- Real-time execution output streamed to the dashboard
- **Server Hardening** -- Automated SSH hardening, firewall setup (UFW), and fail2ban
- **Monitoring** -- Optional Node Exporter and PostgreSQL Exporter for Prometheus metrics
- **Floating IPs** -- Hetzner floating IP management with reverse DNS
- **Network & Firewall Management** -- Create and manage Hetzner private networks and firewalls
- **Patch System** -- Apply rolling patches to running clusters
- **Encrypted Secrets** -- SSH private keys encrypted at rest with AES-256-GCM
- **Authentication** -- Email/password auth via Better Auth with session management
- **Rate Limiting** -- API and auth endpoint protection

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 16, React 19, Tailwind CSS 4, shadcn/ui, xterm.js |
| Backend | Hono, tRPC, Node.js |
| Database | PostgreSQL, Drizzle ORM |
| Auth | Better Auth |
| Infra | Hetzner Cloud API, SSH2 |
| Build | Turborepo, tsdown, Docker |
| Testing | Vitest |

## Getting Started

### Prerequisites

- Node.js 22+
- PostgreSQL
- npm 11+

### Install Dependencies

```bash
npm install
```

### Configure Environment

Copy the example env file and fill in the values:

```bash
cp apps/server/.env.example apps/server/.env
```

Required variables:

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `BETTER_AUTH_SECRET` | Min 32 chars (`openssl rand -hex 32`) |
| `BETTER_AUTH_URL` | Server URL (e.g. `http://localhost:3000`) |
| `CORS_ORIGIN` | Frontend URL (e.g. `http://localhost:3001`) |
| `SECRET_ENCRYPTION_KEY` | 64 hex chars (`openssl rand -hex 32`) |

For the web app, set in `apps/web/.env`:

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_SERVER_URL` | Server URL (e.g. `http://localhost:3000`) |

### Database Setup

```bash
npm run db:push
```

### Run Development Servers

```bash
npm run dev
```

- Web app: [http://localhost:3001](http://localhost:3001)
- API server: [http://localhost:3000](http://localhost:3000)

## Deployment

The project includes two Dockerfiles for separate deployments:

**Server** (`Dockerfile.server`):
```bash
docker build -f Dockerfile.server -t haforge-server .
docker run -p 3000:3000 --env-file .env haforge-server
```

**Web** (`Dockerfile.web`):
```bash
docker build -f Dockerfile.web -t haforge-web .
docker run -p 3001:3001 -e NEXT_PUBLIC_SERVER_URL=https://your-server-url haforge-web
```

> `NEXT_PUBLIC_SERVER_URL` must be available at **build time** for the web app.

## Project Structure

```
HAForge/
├── apps/
│   ├── web/                    # Next.js frontend
│   │   └── src/app/dashboard/  # Dashboard pages (clusters, servers, networks, etc.)
│   └── server/                 # Hono API server
│       └── src/index.ts        # Entry point (tRPC, auth, WebSocket terminal)
├── packages/
│   ├── api/                    # Business logic, tRPC routers, services
│   │   └── src/
│   │       ├── routers/        # tRPC routers (cluster, server, firewall, etc.)
│   │       ├── services/       # Orchestrator, SSH executor, cert generator
│   │       ├── templates/      # Deployment step definitions
│   │       │   ├── postgres/   # Patroni, etcd, PostgreSQL setup
│   │       │   ├── haproxy/    # HAProxy, Keepalived config
│   │       │   ├── monitoring/ # Node & PostgreSQL exporters
│   │       │   └── hardening/  # SSH, UFW, fail2ban
│   │       └── patches/        # Cluster patch system
│   ├── auth/                   # Better Auth configuration
│   ├── db/                     # Drizzle schema & migrations
│   ├── env/                    # Type-safe env validation (server + web)
│   ├── ui/                     # Shared shadcn/ui components
│   └── config/                 # Shared TypeScript config
├── Dockerfile.server           # Server Docker image
├── Dockerfile.web              # Web Docker image
└── turbo.json                  # Turborepo pipeline config
```

## Available Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start all apps in development mode |
| `npm run build` | Build all apps |
| `npm run dev:web` | Start only the web app |
| `npm run dev:server` | Start only the server |
| `npm run check-types` | TypeScript type checking |
| `npm run db:push` | Push schema to database |
| `npm run db:generate` | Generate migrations |
| `npm run db:migrate` | Run migrations |
| `npm run db:studio` | Open Drizzle Studio |
| `npm run test` | Run tests |
| `npm run test:watch` | Run tests in watch mode |
