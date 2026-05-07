# Environment Matrix

> **Created:** 2026-02-14
> **Purpose:** Complete environment variable inventory for every service, with required values and security classification.

> **Public snapshot status:** no production deployment is included, the original Telegram bot has been deleted, and the old website/worker/Dragonfly infrastructure is not live. Treat this matrix as local or future-demo setup guidance.

---

## Classification Legend

- **SECRET** — Never commit. Store in your deployment platform's secret manager or GitHub Actions secrets.
- **CONFIG** — Safe to commit in non-sensitive environments. May vary per environment.
- **PUBLIC** — Safe to expose to client (prefixed with `NEXT_PUBLIC_`).

---

## Apps: Web (`apps/web`)

| Variable | Classification | Required | Default | Description | Source |
|----------|---------------|----------|---------|-------------|--------|
| `DATABASE_URL` | SECRET | Yes | — | Supabase connection string (Transaction Mode pooler URL). Must include `?pgbouncer=true` for Supavisor. | pillar2 |
| `DIRECT_URL` | SECRET | Yes | — | Supabase direct connection (for migrations only, not pooled). | pillar2 |
| `BETTER_AUTH_SECRET` | SECRET | Yes | — | Better Auth signing secret. Min 32 chars, cryptographically random. | pillar4 |
| `BETTER_AUTH_URL` | CONFIG | Yes | — | Base URL for Better Auth (e.g., `https://gordian.yourdomain.com`). | pillar4 |
| `INTERNAL_AUTH_SECRET` | SECRET | Yes | — | Shared secret for web↔worker Handoff Token JWT signing. | followup1 |
| `WORKER_URL` | CONFIG | Yes | — | Worker HTTP endpoint. For local development use `http://localhost:3001`; for deployments prefer a private network endpoint when available. | followup1 |
| `KMS_CMK_ARN` | SECRET | Yes | — | AWS KMS Customer Master Key ARN. | pillar3 |
| `AWS_REGION` | CONFIG | Yes | `us-east-1` | AWS region for KMS. Co-locate with your worker region when possible. | pillar3 |
| `AWS_ACCESS_KEY_ID` | SECRET | Yes | — | AWS IAM credentials for KMS access. | pillar3 |
| `AWS_SECRET_ACCESS_KEY` | SECRET | Yes | — | AWS IAM credentials for KMS access. | pillar3 |
| `NEXT_PUBLIC_SUPABASE_URL` | PUBLIC | No | — | Supabase project URL for optional Realtime updates. If omitted, the app still works with normal page refreshes. | followup3 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | PUBLIC | No | — | Supabase anon key for optional Realtime updates. Safe for client when RLS is enforced. | followup3 |
| `NODE_ENV` | CONFIG | Yes | `production` | Environment mode. | — |
| `WORKER_INTERNAL_SECRET` | SECRET | Yes | — | Preferred shared secret for web→worker API calls (`X-Internal-Secret` header). Falls back to `INTERNAL_AUTH_SECRET` if not set. | phase17 |
| `OAUTH_STATE_SECRET` | SECRET | No | — | HMAC key for Google Calendar OAuth state tokens. Must be different from WORKER_INTERNAL_SECRET. Generate with: `openssl rand -hex 32`. Falls back to `WORKER_INTERNAL_SECRET` if not set. | ASA-001 |
| `NEXT_PUBLIC_APP_URL` | PUBLIC | Yes | `http://localhost:3000` | Public-facing app URL. Used by Better Auth, invites, and OAuth callback redirects. | phase23 |
| `SUPABASE_JWT_SECRET` | SECRET | Only if Realtime is configured | — | Supabase JWT secret for minting Realtime channel tokens. Found in Supabase Dashboard → Settings → API. If omitted, Realtime subscriptions are disabled without blocking the app. | phase15 |
| `GOOGLE_CLIENT_ID` | SECRET | No | — | Google OAuth client ID for Calendar integration. Required only if calendar feature is enabled. | phase23 |
| `GOOGLE_CLIENT_SECRET` | SECRET | No | — | Google OAuth client secret for Calendar integration. Required only if calendar feature is enabled. | phase23 |
| `NEXT_PUBLIC_TELEGRAM_LINKING_ENABLED` | PUBLIC | No | `false` | Shows the Telegram linking UI. Keep `false` unless the worker has MTProto enabled with a dedicated test Telegram app and account. | open-source |
| `TELEGRAM_MTPROTO_ENABLED` | CONFIG | No | `false` | Server-side guard for Telegram account linking and sync calls. Defaults off because saved MTProto sessions can read account data. | open-source |
| `TELEGRAM_SEND_ENABLED` | CONFIG | No | `false` | Server-side hard gate for outbound Telegram message sends. Requires `TELEGRAM_MTPROTO_ENABLED=true` plus workspace feature flags. | open-source |
| `DEV_KMS_BYPASS` | CONFIG | Local demo only | `true` in `.env.example` | Lets seeded local workspaces decrypt without AWS KMS. Refuses to run outside `NODE_ENV=development` or `NODE_ENV=test`. | open-source |
| `SEED_PASSWORD` | CONFIG | Local demo only | `gordian-demo` | Password used by `pnpm seed:demo` for synthetic demo accounts. Change this for any shared demo environment. | open-source |
| `NEXT_PUBLIC_DEMO_LOGIN_ENABLED` | PUBLIC | Local demo only | `true` in `.env.example` | Shows the seeded local demo login helper. Set to `false` for any shared or production deployment. | open-source |
| `NEXT_PUBLIC_DEMO_EMAIL` | PUBLIC | Local demo only | `alice@gordian.dev` | Email shown by the local demo login helper. Must match a seeded demo user. | open-source |
| `NEXT_PUBLIC_DEMO_PASSWORD` | PUBLIC | Local demo only | `gordian-demo` | Password inserted by the local demo login helper. Public by design; never reuse for real deployments. | open-source |

## Apps: Worker (`apps/worker`)

| Variable | Classification | Required | Default | Description | Source |
|----------|---------------|----------|---------|-------------|--------|
| `DATABASE_URL` | SECRET | Yes | — | Same as web — Supabase pooler URL with `prepare: false`. | pillar2 |
| `DRAGONFLY_URL` | SECRET | Yes | — | DragonflyDB or Redis-compatible connection URL. Prefer a private network endpoint in deployed environments. | followup6 |
| `TELEGRAM_BOT_ENABLED` | CONFIG | No | `false` | Starts grammY long polling only when explicitly enabled. Leave disabled in public forks unless using a dedicated test bot. | open-source |
| `TELEGRAM_MTPROTO_ENABLED` | CONFIG | No | `false` | Enables MTProto session creation and sync. Leave disabled unless `TELEGRAM_API_ID` and `TELEGRAM_API_HASH` belong to a throwaway/test Telegram app. | open-source |
| `TELEGRAM_SEND_ENABLED` | CONFIG | No | `false` | Enables outbound Telegram sends. Keep disabled unless the deployment has reviewed rate limits, audit logging, and user confirmation flows. | open-source |
| `BOT_TOKEN` | SECRET | Only if `TELEGRAM_BOT_ENABLED=true` | — | Telegram Bot API token from @BotFather. The original bot has been deleted; create a new dedicated test bot for public forks. | pillar6 |
| `TELEGRAM_API_ID` | SECRET | Only if `TELEGRAM_MTPROTO_ENABLED=true` | — | Telegram API ID for MTProto (GramJS). Use a dedicated test Telegram app. | followup2 |
| `TELEGRAM_API_HASH` | SECRET | Only if `TELEGRAM_MTPROTO_ENABLED=true` | — | Telegram API Hash for MTProto (GramJS). Treat as high-risk with saved session strings. | followup2 |
| `INTERNAL_AUTH_SECRET` | SECRET | Yes | — | Must match web's value. For Handoff Token verification. | followup1 |
| `WEB_URL` | CONFIG | Yes | — | Web app URL for JWKS verification (e.g., `https://gordian.yourdomain.com`). | pillar4 |
| `KMS_CMK_ARN` | SECRET | Yes | — | AWS KMS CMK ARN (same as web). | pillar3 |
| `AWS_REGION` | CONFIG | Yes | `us-east-1` | AWS region. | pillar3 |
| `AWS_ACCESS_KEY_ID` | SECRET | Yes | — | AWS IAM credentials. | pillar3 |
| `AWS_SECRET_ACCESS_KEY` | SECRET | Yes | — | AWS IAM credentials. | pillar3 |
| `SUPABASE_URL` | SECRET | Yes | — | Supabase URL (service role — for Realtime Broadcast). | followup3 |
| `SUPABASE_SERVICE_KEY` | SECRET | Yes | — | Supabase service role key. **Never expose to client.** | followup3 |
| `ANTHROPIC_API_KEY` | SECRET | Yes | — | Anthropic API key for Claude inference. | pillar7 |
| `OPENAI_API_KEY` | SECRET | Yes | — | OpenAI API key for `text-embedding-3-small`. Required for the hybrid search embedding pipeline. Without it, embedding generation throws and AI pipeline jobs fail. | followup8 |
| `GEMINI_API_KEY` | SECRET | No | — | Optional Gemini API key for experimental Gemini inference paths. | open-source |
| `HELICONE_API_KEY` | SECRET | No | — | Helicone observability key. Optional but recommended. | followup9 |
| `POSTHOG_API_KEY` | SECRET | No | — | Optional server-side PostHog project key for worker analytics. | open-source |
| `POSTHOG_HOST` | CONFIG | No | `https://us.i.posthog.com` | Optional server-side PostHog host override. | open-source |
| `NEXT_PUBLIC_POSTHOG_KEY` | PUBLIC | No | — | Optional browser-visible PostHog project key for web analytics. Leave blank for local demo. | open-source |
| `NEXT_PUBLIC_POSTHOG_HOST` | PUBLIC | No | `https://us.i.posthog.com` | Optional browser-visible PostHog host override. | open-source |
| `PROMPT_VERSION` | CONFIG | No | `v1` | Current prompt version tag for Helicone tracking. | followup9 |
| `FEATURE_OUTCOME_SCORING` | CONFIG | No | `false` | Enables outcome-scoring workers and related logic when set to `true`. | open-source |
| `NODE_ENV` | CONFIG | Yes | `production` | Environment mode. | — |
| `NODE_OPTIONS` | CONFIG | Yes | `--max-old-space-size=384` | Limit Node.js heap to 384MB (leave room for DragonflyDB). | pillar1 |
| `CORS_ORIGIN` | CONFIG | No | `http://localhost:3000` | Comma-separated trusted origins for worker CORS. Keep narrow in deployments. | open-source |

## Packages: Crypto (`packages/crypto`)

| Variable | Classification | Required | Default | Description | Source |
|----------|---------------|----------|---------|-------------|--------|
| `DEV_KMS_BYPASS` | CONFIG | No | — | **Dev only.** Set to `true` to skip real AWS KMS calls. The WRK is passed through as-is (no decryption). Throws `Error` at startup if production/deployment environment markers are present. | sprint6 |

## Packages: Shared (`packages/shared`)

| Variable | Classification | Required | Default | Description | Source |
|----------|---------------|----------|---------|-------------|--------|
| `HANDOFF_JWT_SECRET` | SECRET | No | Falls back to `INTERNAL_AUTH_SECRET` | Dedicated HS256 signing secret for web→worker Handoff Tokens. If omitted, `INTERNAL_AUTH_SECRET` is used. Separating these secrets limits blast radius if the internal service secret is rotated. Must match across all services that create or verify handoff tokens. | sprint6 |

## Infrastructure (Auto-Detected)

These variables are **not set by users**. They may be injected automatically by a deployment platform and read by application code to detect the runtime environment.

| Variable | Injected By | Used In | Effect |
|----------|------------|---------|--------|
| `FLY_APP_NAME` | Fly.io, if used | `apps/worker/src/redis.ts`, `packages/crypto/src/kms.ts`, `apps/worker/src/index.ts` | Enables IPv6 (`family: 6`) for ioredis internal networking. Also acts as a production-environment signal: `DEV_KMS_BYPASS` throws if this is set. |
| `COOLIFY_URL` | Coolify, if used | `packages/crypto/src/kms.ts`, `apps/web/src/instrumentation.ts` | Production-environment signal for the web app: `DEV_KMS_BYPASS` throws if this is set. |

## Infrastructure: DragonflyDB / Redis-Compatible Cache

| Variable | Classification | Required | Default | Description | Source |
|----------|---------------|----------|---------|-------------|--------|
| `DFLY_maxmemory` | CONFIG | Yes | `256mb` | Max memory allocation. | pillar1 |
| `DFLY_cache_mode` | CONFIG | Yes | `false` | **MUST be false.** Prevents silent eviction. | followup6 |
| `DFLY_proactor_threads` | CONFIG | Yes | `2` | I/O threads (match shared-cpu-1x). | followup6 |
| `DFLY_cluster_mode` | CONFIG | Yes | `emulated` | Required for BullMQ hashtag routing. | followup6 |
| `DFLY_lock_on_hashtags` | CONFIG | Yes | (flag) | Enable hashtag-based locking for BullMQ Lua scripts. | followup6 |
| `DFLY_snapshot_cron` | CONFIG | Yes | `*/15 * * * *` | Snapshot every 15 minutes. | followup6 |
| `DFLY_dir` | CONFIG | Yes | `s3://example-dragonfly-backups` | Snapshot destination. Use a deployment-specific bucket. | followup6 |
| `DFLY_s3_endpoint` | CONFIG | Yes | — | Object storage endpoint for snapshots, if enabled. | followup6 |
| `DFLY_admin_port` | CONFIG | No | `9999` | Admin/metrics port. | followup6 |

---

## GitHub Actions Secrets

| Secret | Used By | Description |
|--------|---------|-------------|
Public CI does not require deployment secrets. If you add demo deployment workflows later, keep their tokens in GitHub Actions secrets and scope them to throwaway/demo infrastructure.

---

## Environment-Specific Overrides

### Development (Local)

```bash
# .env.local (not committed)
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/gordian_dev"
DRAGONFLY_URL="redis://localhost:6379"
DEV_KMS_BYPASS="true"
SEED_PASSWORD="gordian-demo"
NEXT_PUBLIC_DEMO_LOGIN_ENABLED="true"
NEXT_PUBLIC_DEMO_EMAIL="alice@gordian.dev"
NEXT_PUBLIC_DEMO_PASSWORD="gordian-demo"
NEXT_PUBLIC_APP_URL="http://localhost:3000"
BOT_TOKEN="<test-bot-token>"
TELEGRAM_BOT_ENABLED="false"
TELEGRAM_MTPROTO_ENABLED="false"
TELEGRAM_SEND_ENABLED="false"
NEXT_PUBLIC_TELEGRAM_LINKING_ENABLED="false"
INTERNAL_AUTH_SECRET="dev-secret-min-32-chars-long-enough"
WORKER_INTERNAL_SECRET="dev-worker-secret-min-32-chars-long-enough"
BETTER_AUTH_SECRET="dev-auth-secret-min-32-chars-long"
BETTER_AUTH_URL="http://localhost:3000"
WORKER_URL="http://localhost:3001"
WEB_URL="http://localhost:3000"
CORS_ORIGIN="http://localhost:3000"
NEXT_PUBLIC_SUPABASE_URL="http://localhost:54321"
NEXT_PUBLIC_SUPABASE_ANON_KEY="<local-supabase-anon-key>"
SUPABASE_JWT_SECRET="<local-supabase-jwt-secret>"
GOOGLE_CLIENT_ID=""
GOOGLE_CLIENT_SECRET=""
OAUTH_STATE_SECRET=""
POSTHOG_API_KEY=""
NEXT_PUBLIC_POSTHOG_KEY=""
NODE_ENV="development"
FEATURE_OUTCOME_SCORING="false"
```

### Staging

Same as production but with:
- Separate Supabase project (staging database)
- Separate KMS key (staging CMK)
- Test Telegram bot and Telegram API app
- Separate worker/cache deployments

### Production

No production deployment is included in this public snapshot. If you create one later, set all values from the "Required" columns above via your deployment platform's runtime secret/environment variable manager. Keep GitHub Actions secrets empty unless a demo deployment workflow is intentionally added.

---

## Security Notes

1. **Never commit `.env` files.** Add to `.gitignore`.
2. **Rotate `INTERNAL_AUTH_SECRET` on team member departure.** Both web and worker must be redeployed simultaneously.
3. **KMS CMK has automatic rotation** (AWS manages, 365-day cycle). WRK rotation is application-managed.
4. **`SUPABASE_SERVICE_KEY`** has full database access — only used in worker (server-side). Never in web client bundle.
5. **`ANTHROPIC_API_KEY`** — set spend limits in Anthropic console to prevent runaway costs.
