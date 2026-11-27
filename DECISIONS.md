# Decisions

## What was built
- Pigeon webhook, durable inbound and outbound messaging, retries with stable
  idempotency keys, shared rate limiting, atomic claims.
- OIDC login (authorization code + PKCE S256), Redis sessions, tenant isolation.
- WebSocket with per-workspace sequence numbers, replay (`after`) and
  cross-instance delivery.
- A minimal React inbox: sign in, workspace switcher, conversation list (newest
  activity first), thread, reply with status (queued, sent, delivered, failed),
  claim, close and reopen, live updates, reconnect from the last seq.
- Unit tests for webhook signature verification and PKCE.

## What was cut
Encrypted private notes (`PROTOCOL.md` is therefore absent), Elasticsearch
search, the Paybox billing bonus, UI polish, pagination controls in the UI
(the API paginates with `limit` and `offset`), and a "release claim" action.

## Key decisions
- **MongoDB is the source of truth.** A webhook is journaled (unique
  `event_id`), applied idempotently, and only then answered 200. Inbound
  messages are unique on `message_id` and ordered by the provider's
  `occurred_at` (ties by `message_id`), never by arrival. A crash between
  journaling and applying is safe: Pigeon retries and the effects are idempotent.
- **Webhook security.** The signature is checked on the raw bytes
  (`express.raw` on that route only; no global JSON parser) with HMAC-SHA256 and
  `timingSafeEqual` before anything is parsed. Timestamps older than 300 s are
  rejected; slightly future ones are accepted. Bad signature is always 401, bad
  JSON 400, unknown event types and workspaces 200 and ignored.
- **Status never regresses.** `queued -> sent -> delivered|failed`; the update
  filters on the allowed previous states, so a late `sent` cannot overwrite a
  terminal status. Accepted by Pigeon is not delivered: only the status webhook
  advances the visible status.
- **Replies are durable before 202.** A reply is inserted (unique on
  `workspace + client_ref`) before the request is answered. The Pigeon
  `Idempotency-Key` is derived from that identity, so every retry, from any
  process, reuses it.
- **Workers claim with atomic updates** (`findOneAndUpdate` on
  `send_state`), with a 20 s lease. If a process dies, its claimed messages
  become claimable again, which gives crash recovery and failover without a
  coordinator. Retry state (attempts, next attempt time) is in MongoDB.
- **Redis coordinates the rate limit.** One token bucket per workspace (burst 3,
  3.5 per second, below Pigeon's 8 and 4) shared by every process. A slot is
  reserved even when the caller must wait; without that, all waiting workers
  fire together (this was a real failure in level 3). A 429 sets a shared
  cool-off from `Retry-After`; workers skip cooling workspaces when claiming.
  503s and timeouts back off with jitter and retry forever.
- **Atomic claims.** One conditional upsert on the unique
  `(workspace, contact)` index: match if unassigned or the same agent, otherwise
  the insert hits the unique index and the answer is 409. No read-then-write.
- **Auth.** PKCE verifier, state and nonce live in Redis (single use), so the
  callback can land on any instance. The id_token signature, issuer, audience,
  expiry and nonce are verified. Sessions are random ids in Redis with an
  HttpOnly, SameSite=Lax cookie. Every workspace route checks membership
  against the session first (403 otherwise; unknown workspaces look the same).
  In the UI the agent for a claim is the signed-in user, never request input.
- **Real time.** Each change is an event row with a per-workspace `seq` from an
  atomic counter, unique on `(workspace, key)` so duplicates add nothing. Redis
  pub/sub only wakes sockets; each socket reads the table in seq order from its
  own cursor. Replay and live are therefore the same loop, so nothing is sent
  twice or missed between them. A short gap wait (1.5 s) covers a higher seq
  becoming visible before a lower one is written.
- **Reset** clears the application collections and the `sb:pigeon:*` Redis keys
  only; sessions (`sb:sess:*`) stay.
- `switchboard.json` exists at the root and in `starter/` because the project
  lives in the `starter/` subfolder of this repository.

## Assumptions where the brief is silent
- `closed` conversations stay closed when a customer writes again; an agent
  reopens them.
- `contact` is the customer's phone number as Pigeon sends it, unnormalised.
- Reply text is limited to 4000 characters.

## What I know is still wrong or unverified
- **The check was run on Windows with a helper outside the repository.** The
  harness stops an instance with `process.kill(-pid, 'SIGKILL')`, which does
  nothing on Windows, so levels 2 and 3 cannot run as shipped. I ran them with a
  preload shim (not committed) that kills the instance by its listening port.
  Level 1 and 5 do not need it. The scores in `CHECK_REPORT.json` come from
  that setup; on Linux the harness should work unmodified, but I did not run it
  there.
- The check ran with 2 instances; the hiring team uses 3 with larger numbers.
  Level 4 (written rules) cannot be run locally and is unscored.
- A sequence number can be skipped in a rare insert race; sockets then wait up
  to 1.5 s and continue. A socket that stays connected across a grader reset
  stops receiving (the counter restarts at 1).
- If MongoDB is unreachable at boot, the process exits instead of retrying.
- The UI refetches the list and open thread on every frame instead of patching
  state: simple and correct, wasteful at scale. It was built and type-checked
  but only exercised by hand through the API, not by a browser test.
- The inbox list is an offset-paginated read of the contacts collection; there
  is no unread tracking or search.
