# Switchboard

A shared team inbox. Customers write to a business through a messaging provider
(Pigeon); support agents sign in, see conversations arrive live, claim them,
reply, and close or reopen them. Several businesses (workspaces) share one
deployment and never see each other's data.

The application lives in [`starter/`](starter/). The repository root only holds
the submission files (this README, `DECISIONS.md`, `CHECK_REPORT.json`,
`switchboard.json`, `ai-logs/`) and the pre-assessment material.
`switchboard.json` here points into `starter/`; `starter/switchboard.json` is
the same thing relative to `starter/` and is what the check harness reads.

## Architecture

```
Pigeon :4010 --webhook--> server (Express + TypeScript) --WebSocket--> React app
                              |  MongoDB: durable state (events, messages, replies, claims, event log)
                              |  Redis:   sessions, PKCE state, rate limit + cool-off, change notifications
                              +--> POST /v1/messages on Pigeon (outbound worker)
```

Server code is in `starter/scaffold/server/src/`, one responsibility per file:

| Folder | Responsibility |
| --- | --- |
| `pigeon/` | webhook (`webhook.ts`, `signature.ts`), outbound client (`send.ts`), worker (`worker.ts`), shared rate limit (`ratelimit.ts`), Mongo collections and indexes (`store.ts`) |
| `conversations/` | claim rule and atomic claim, list, thread, close/reopen |
| `auth/` | OIDC code flow with PKCE, id_token verification, Redis sessions, cookies, middleware |
| `api/` | `/api/me`, `/api/conversations`, `/api/messages`, `/api/reply`, `/api/claim`, `/api/close`, `/api/reopen` |
| `realtime/` | per-workspace event log and sequence numbers, Redis wake-ups, per-socket pump, WebSocket upgrade |
| `grader/` | `/__grader/*` endpoints used by the check |

The React app is in `starter/scaffold/web/src/` (inbox list, thread, reply box,
claim, close/reopen, workspace switcher, live updates with reconnect).

## Prerequisites

Node 22, git, Docker Desktop (MongoDB, Redis and the simulators). Without
Docker, `npm run mocks` starts the simulators with plain Node and you point
`MONGO_URL` and `REDIS_URL` at a MongoDB and Redis you already have.

## Run from a clean clone

```
cd starter
npm run up                 # MongoDB, Redis, Pigeon, mock IdP, Paybox (Docker)
npm run doctor             # every line should be PASS (Elasticsearch is optional)
npm run scaffold:install   # server and web dependencies
npm run scaffold:server    # API on http://localhost:4000 (PORT overrides)
npm run scaffold:web       # React app on http://localhost:5173
```

Open http://localhost:5173 and sign in. There are no passwords: the mock IdP
lists five test users (see `starter/START_HERE.md`). `npm run inbound` makes a
customer write to you; `npm run quiet` stops the automatic trickle.

From the repository root the install and start commands in `switchboard.json`
do the same for the server: `npm --prefix starter run scaffold:install`, then
`npm --prefix starter run start:server`.

## Configuration

Everything comes from the environment. Defaults match the harness and are
development values only (there are no real secrets in this repository).
`starter/.env` is optional and git-ignored; see `starter/.env` defaults in
`scaffold/server/src/config.ts`.

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `4000` | server port |
| `WEB_ORIGIN` | `http://localhost:5173` | where the browser is sent after login |
| `GRADER_TOKEN` | `grader-dev-token` | `x-grader-token` for `/__grader/*` |
| `MONGO_URL`, `REDIS_URL` | local | data stores |
| `PIGEON_URL`, `PIGEON_WEBHOOK_SECRET`, `PIGEON_KEY_WS_ACME`, `PIGEON_KEY_WS_GLOBEX` | harness values | provider URL, webhook secret, per-workspace API keys |
| `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_REDIRECT_URI` | harness values | login |
| `SERVER_URL` | `http://localhost:4000` | dev proxy target for the web app |

## Checks

```
cd starter
npm run check                      # level 1 (about 90 s)
npm run check -- --levels 2        # one level on its own
npm run check:full                 # levels 1, 2, 3 and 5; writes CHECK_REPORT.json
npm --prefix scaffold/server run typecheck
npm --prefix scaffold/server test  # unit tests (signature, PKCE)
npm --prefix scaffold/web run build
```

The check deletes application data and starts the server itself: stop your dev
server first. Result of the last full run: see `CHECK_REPORT.json` (75 of 75
for levels 1, 2, 3 and 5; level 4 is not part of the public check). Read
`DECISIONS.md` before trusting that number on Windows.
