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
| `POSTGRES_TEMP_FILE_LIMIT` | CONFIG | No | `256MB` | Transaction-scoped Postgres temp-file cap applied before heavy local metadata derivation queries when the database allows it. Set `0` or `off` to disable. This limits scratch-file growth; it does not provide encryption by itself. | local-security |
| `BETTER_AUTH_SECRET` | SECRET | Yes | — | Better Auth signing secret. Min 32 chars, cryptographically random. | pillar4 |
| `BETTER_AUTH_URL` | CONFIG | Yes | — | Base URL for Better Auth (e.g., `https://gordian.yourdomain.com`). | pillar4 |
| `INTERNAL_AUTH_SECRET` | SECRET | Yes | — | Shared secret for web↔worker Handoff Token JWT signing. | followup1 |
| `WORKER_URL` | CONFIG | Yes | — | Worker HTTP endpoint. For local development use `http://localhost:3001`; for deployments prefer a private network endpoint when available. | followup1 |
| `WORKER_HOST` | CONFIG | No | `127.0.0.1` locally, `0.0.0.0` in production | Interface the worker HTTP server binds to. Keep loopback for local runs. | open-source |
| `KMS_CMK_ARN` | SECRET | Yes | — | AWS KMS Customer Master Key ARN. | pillar3 |
| `AWS_REGION` | CONFIG | Yes | `us-east-1` | AWS region for KMS. Co-locate with your worker region when possible. | pillar3 |
| `AWS_ACCESS_KEY_ID` | SECRET | Yes | — | AWS IAM credentials for KMS access. | pillar3 |
| `AWS_SECRET_ACCESS_KEY` | SECRET | Yes | — | AWS IAM credentials for KMS access. | pillar3 |
| `NEXT_PUBLIC_SUPABASE_URL` | PUBLIC | No | — | Supabase project URL for optional Realtime updates. If omitted, the app still works with normal page refreshes. | followup3 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | PUBLIC | No | — | Supabase anon key for optional Realtime updates. Safe for client when RLS is enforced. | followup3 |
| `NODE_ENV` | CONFIG | Yes | `production` | Environment mode. | — |
| `WORKER_INTERNAL_SECRET` | SECRET | Yes | — | Preferred shared secret for web→worker API calls (`X-Internal-Secret` header). Falls back to `INTERNAL_AUTH_SECRET` if not set. | phase17 |
| `PHONE_REDIS_KEY_SECRET` | SECRET | Recommended if Telegram MTProto is enabled | — | HMAC key for Redis phone auth/rate-limit keys. Falls back to `WORKER_INTERNAL_SECRET` or `INTERNAL_AUTH_SECRET`, but a dedicated value reduces cross-secret blast radius. | personal-tg |
| `ADMIN_AI_REPROCESS_CONFIRM_SECRET` | SECRET | Recommended if admin AI reprocess is enabled | — | HMAC key for short-lived dry-run confirmation tokens on `/admin/reprocess-messages`. Falls back to `WORKER_INTERNAL_SECRET` or `INTERNAL_AUTH_SECRET`. | personal-tg |
| `OAUTH_STATE_SECRET` | SECRET | No | — | HMAC key for Google Calendar OAuth state tokens. Must be different from WORKER_INTERNAL_SECRET. Generate with: `openssl rand -hex 32`. Falls back to `WORKER_INTERNAL_SECRET` if not set. | ASA-001 |
| `NEXT_PUBLIC_APP_URL` | PUBLIC | Yes | `http://localhost:3000` | Public-facing app URL. Used by Better Auth, invites, and OAuth callback redirects. | phase23 |
| `SUPABASE_JWT_SECRET` | SECRET | Only if Realtime is configured | — | Supabase JWT secret for minting Realtime channel tokens. Found in Supabase Dashboard → Settings → API. If omitted, Realtime subscriptions are disabled without blocking the app. | phase15 |
| `GOOGLE_CLIENT_ID` | SECRET | No | — | Google OAuth client ID for Calendar integration. Required only if calendar feature is enabled. | phase23 |
| `GOOGLE_CLIENT_SECRET` | SECRET | No | — | Google OAuth client secret for Calendar integration. Required only if calendar feature is enabled. | phase23 |
| `NEXT_PUBLIC_TELEGRAM_LINKING_ENABLED` | PUBLIC | No | `false` | Shows the Telegram linking UI. Keep `false` unless the worker has MTProto enabled and the user is ready to accept MTProto session custody. | open-source |
| `NEXT_PUBLIC_AI_PROCESSING_ENABLED` | PUBLIC | No | `false` | Shows and enables AI analysis consent controls in the onboarding sync UI. This does not enable vendor egress; server and worker still require `AI_PROCESSING_ENABLED=true`. Keep false for local primary-account testing. | open-source |
| `TELEGRAM_MTPROTO_ENABLED` | CONFIG | No | `false` | Server-side guard for Telegram account linking and sync calls. Defaults off because saved MTProto sessions can read account data. | open-source |
| `TELEGRAM_SEND_ENABLED` | CONFIG | No | `false` | Server-side hard gate for outbound Telegram message sends. Requires `TELEGRAM_MTPROTO_ENABLED=true` plus workspace feature flags. | open-source |
| `TELEGRAM_FULL_BACKFILL_ENABLED` | CONFIG | No | `false` | Allows full-history backfill jobs after initial sync. Keep `false` unless the user explicitly wants deep history import. | personal-tg |
| `TELEGRAM_PERIODIC_SYNC_ENABLED` | CONFIG | No | `false` | Allows recurring background Telegram sync. Keep `false` for local-first personal-account testing. | personal-tg |
| `TELEGRAM_MTPROTO_SESSION_IDLE_MINUTES` | CONFIG | No | `30`; use `5` for personal accounts | Local GramJS helper idle timeout. Terminal imports disconnect the Telegram client first; after this many idle minutes the helper thread is terminated and remaining helper-thread memory is dropped. The linked session remains encrypted at rest. | personal-tg |
| `TELEGRAM_SESSION_KEY_PROVIDER` | CONFIG | Only if `TELEGRAM_MTPROTO_ENABLED=true` | `dev-insecure` in `.env.example` | Protects the per-user MTProto session unwrap key. Use `os-keychain` for local macOS personal-account use or `aws-kms` for KMS-backed setups. `dev-insecure` is synthetic-demo only and is refused when MTProto is enabled. | personal-tg |
| `TELEGRAM_KEYCHAIN_SERVICE` | CONFIG | Only if `TELEGRAM_SESSION_KEY_PROVIDER=os-keychain` | `gordian-v2-telegram` | macOS Keychain service name used for Telegram session unwrap keys. The database stores only a marker for these keys. Keep separate from `WORKSPACE_KEYCHAIN_SERVICE` so import-session unlocks are distinct from workspace-data unlocks. | personal-tg |
| `TELEGRAM_KEYCHAIN_REQUIRE_USER_PRESENCE` | CONFIG | No | `false` | Enables the additional user-presence path for Telegram session Keychain reads. Pair with `TELEGRAM_KEYCHAIN_USER_PRESENCE_MODE`. | personal-tg |
| `TELEGRAM_KEYCHAIN_USER_PRESENCE_MODE` | CONFIG | No | `compat` | `compat` uses the current macOS ACL prompt path. `strict` uses macOS `SecAccessControl.userPresence` and should be verified with `pnpm telegram:touchid:probe`. | personal-tg |
| `GORDIAN_KEYCHAIN_HELPER_PATH` | CONFIG | No | — | Optional path to a broker executable, for example `/Users/you/Library/Application Support/Gordian/GordianKeychainBrokerXcode/Build/Products/Debug/GordianKeychainBroker.app/Contents/MacOS/GordianKeychainBroker`. When set, strict Keychain reads use this helper so macOS prompts identify Gordian. | personal-tg |
| `TELEGRAM_MTPROTO_PER_INTERACTION_UNLOCK` | CONFIG | No | `false` | When false, one user-presence unlock opens the MTProto session for an import run, and the worker disconnects the local Telegram client when the run completes, pauses, cancels, or finally fails. Set true only for repeated per-read unlocks. | personal-tg |
| `TELEGRAM_ALLOW_SESSION_UNWRAP_OUTSIDE_IMPORTS` | CONFIG | No | `false` | Allows legacy sync/backfill workers to open the stored MTProto session. Keep false for personal accounts so stored session unwrap is limited to the explicit history import flow. | personal-tg |
| `TELEGRAM_RECENT_IMPORT_MAX_PAGES_PER_CHAT` | CONFIG | No | `1` | Page cap for dashboard recent-only imports when old-history backfill is not explicitly selected. Keeps local MTProto imports focused on new messages instead of duplicate-heavy historical pages. | personal-tg |
| `TELEGRAM_IMPORT_WORKER_LOCK_DURATION_MS` | CONFIG | No | `600000` | BullMQ lock duration for Telegram history import jobs. Increase if local imports log lock-renewal errors while pages are still completing. | personal-tg |
| `TELEGRAM_IMPORT_WORKER_STALLED_INTERVAL_MS` | CONFIG | No | `60000` | BullMQ stalled-job scan interval for Telegram history import jobs. | personal-tg |
| `TELEGRAM_IMPORT_WORKER_MAX_STALLED_COUNT` | CONFIG | No | `2` | Number of stalled recoveries allowed before BullMQ fails a Telegram import job. | personal-tg |
| `TELEGRAM_API_CREDENTIAL_PROVIDER` | CONFIG | Only if `TELEGRAM_MTPROTO_ENABLED=true` | `env` in `.env.example`; `os-keychain` from setup | Controls where the Telegram API app `api_id` and `api_hash` are read from. Use `os-keychain` for normal macOS local use. | personal-tg |
| `TELEGRAM_API_KEYCHAIN_ACCOUNT` | CONFIG | Only if `TELEGRAM_API_CREDENTIAL_PROVIDER=os-keychain` | `telegram-api-credentials` | macOS Keychain account name for the Telegram API app credential JSON. | personal-tg |
| `TELEGRAM_API_ID` | SECRET | Only if `TELEGRAM_MTPROTO_ENABLED=true` and `TELEGRAM_API_CREDENTIAL_PROVIDER=env` | — | Telegram API ID from `my.telegram.org`. `pnpm telegram:setup` stores this in macOS Keychain by default and clears the env value. | personal-tg |
| `TELEGRAM_API_HASH` | SECRET | Only if `TELEGRAM_MTPROTO_ENABLED=true` and `TELEGRAM_API_CREDENTIAL_PROVIDER=env` | — | Telegram API hash from `my.telegram.org`. Prefer Keychain mode and never prefix this with `NEXT_PUBLIC_`. | personal-tg |
| `DEV_KMS_BYPASS` | CONFIG | Local demo only | `true` in `.env.example` | Lets seeded local workspaces decrypt without AWS KMS. Refuses to run outside `NODE_ENV=development` or `NODE_ENV=test`. | open-source |
| `WORKSPACE_KEY_PROVIDER` | CONFIG | No | `dev-insecure` when `DEV_KMS_BYPASS=true`; otherwise `aws-kms` | Protects workspace root keys for encrypted local data. Use `os-keychain` for real local macOS workspaces so Postgres stores only a marker; use `aws-kms` for KMS-backed deployments; keep `dev-insecure` for synthetic demo/test data only. | local-security |
| `WORKSPACE_KEYCHAIN_SERVICE` | CONFIG | Only if `WORKSPACE_KEY_PROVIDER=os-keychain` | `gordian-v2-workspace` | macOS Keychain service name used for workspace root keys. Keep separate from `TELEGRAM_KEYCHAIN_SERVICE` so dashboard/local-data unlocks are distinct from Telegram import-session unlocks. | local-security |
| `WORKSPACE_KEY_CACHE_TTL_MINUTES` | CONFIG | No | `5` | How long an unwrapped workspace root key may stay in process memory. Set `60` for smoother local use; set `0` to read Keychain every unwrap. | local-security |
| `SEED_PASSWORD` | CONFIG | Local demo only | `gordian-demo` | Password used by `pnpm seed:demo` for synthetic demo accounts. Change this for any shared demo environment. | open-source |
| `NEXT_PUBLIC_DEMO_LOGIN_ENABLED` | PUBLIC | Local demo only | `true` in `.env.example` | Shows the seeded local demo login helper. Set to `false` for any shared or production deployment. | open-source |
| `NEXT_PUBLIC_DEMO_EMAIL` | PUBLIC | Local demo only | `alice@gordian.dev` | Email shown by the local demo login helper. Must match a seeded demo user. | open-source |
| `NEXT_PUBLIC_DEMO_PASSWORD` | PUBLIC | Local demo only | `gordian-demo` | Password inserted by the local demo login helper. Public by design; never reuse for real deployments. | open-source |

## Apps: Worker (`apps/worker`)

| Variable | Classification | Required | Default | Description | Source |
|----------|---------------|----------|---------|-------------|--------|
| `DATABASE_URL` | SECRET | Yes | — | Same as web — Supabase pooler URL with `prepare: false`. | pillar2 |
| `DRAGONFLY_URL` | SECRET | Yes | — | DragonflyDB or Redis-compatible connection URL. Prefer a private network endpoint in deployed environments. | followup6 |
| `POSTGRES_TEMP_FILE_LIMIT` | CONFIG | No | `256MB` | Transaction-scoped Postgres temp-file cap applied before heavy local metadata derivation queries when the database allows it. Set `0` or `off` to disable. This limits scratch-file growth; it does not provide encryption by itself. | local-security |
| `TELEGRAM_BOT_ENABLED` | CONFIG | No | `false` | Starts grammY long polling only when explicitly enabled. Leave disabled in public forks unless using a dedicated test bot. | open-source |
| `TELEGRAM_MTPROTO_ENABLED` | CONFIG | No | `false` | Enables MTProto session creation and sync. Leave disabled until the user has reviewed session custody and revocation steps. | open-source |
| `TELEGRAM_SEND_ENABLED` | CONFIG | No | `false` | Enables outbound Telegram sends. Keep disabled unless the deployment has reviewed rate limits, audit logging, and user confirmation flows. | open-source |
| `TELEGRAM_FULL_BACKFILL_ENABLED` | CONFIG | No | `false` | Enables Tier 2 full-history backfill after a user-selected import. Defaults off for personal Telegram accounts. | personal-tg |
| `TELEGRAM_PERIODIC_SYNC_ENABLED` | CONFIG | No | `false` | Enables 15-minute recurring sync and startup bootstrap sync. Defaults off so local personal-account sync is user-initiated. | personal-tg |
| `TELEGRAM_MTPROTO_SESSION_IDLE_MINUTES` | CONFIG | No | `30`; use `5` for personal accounts | Local GramJS worker idle timeout. After this many idle minutes the worker is terminated and decrypted Telegram client/session material is dropped from process memory; the linked session remains encrypted at rest. | personal-tg |
| `TELEGRAM_SESSION_KEY_PROVIDER` | CONFIG | Only if `TELEGRAM_MTPROTO_ENABLED=true` | `dev-insecure` in `.env.example` | Protects the per-user MTProto session unwrap key. Use `os-keychain` for local macOS personal-account use or `aws-kms` for KMS-backed setups. `dev-insecure` is synthetic-demo only and is refused when MTProto is enabled. | personal-tg |
| `TELEGRAM_KEYCHAIN_SERVICE` | CONFIG | Only if `TELEGRAM_SESSION_KEY_PROVIDER=os-keychain` | `gordian-v2-telegram` | macOS Keychain service name used for Telegram session unwrap keys. The database stores only a marker for these keys. Keep separate from `WORKSPACE_KEYCHAIN_SERVICE`. | personal-tg |
| `TELEGRAM_KEYCHAIN_REQUIRE_USER_PRESENCE` | CONFIG | No | `false` | Enables the additional user-presence path for Telegram session Keychain reads. Pair with `TELEGRAM_KEYCHAIN_USER_PRESENCE_MODE`. | personal-tg |
| `TELEGRAM_KEYCHAIN_USER_PRESENCE_MODE` | CONFIG | No | `compat` | `compat` uses the current macOS ACL prompt path. `strict` uses macOS `SecAccessControl.userPresence` and should be verified with `pnpm telegram:touchid:probe`. | personal-tg |
| `GORDIAN_KEYCHAIN_HELPER_PATH` | CONFIG | No | — | Optional path to a broker executable, for example `/Users/you/Library/Application Support/Gordian/GordianKeychainBrokerXcode/Build/Products/Debug/GordianKeychainBroker.app/Contents/MacOS/GordianKeychainBroker`. When set, strict Keychain reads use this helper so macOS prompts identify Gordian. | personal-tg |
| `TELEGRAM_MTPROTO_PER_INTERACTION_UNLOCK` | CONFIG | No | `false` | When false, one user-presence unlock opens the MTProto session for an import run, and the worker disconnects the local Telegram client when the run completes, pauses, cancels, or finally fails. Set true only for repeated per-read unlocks. | personal-tg |
| `TELEGRAM_ALLOW_SESSION_UNWRAP_OUTSIDE_IMPORTS` | CONFIG | No | `false` | Allows legacy sync/backfill workers to open the stored MTProto session. Keep false for personal accounts so stored session unwrap is limited to the explicit history import flow. | personal-tg |
| `TELEGRAM_RECENT_IMPORT_MAX_PAGES_PER_CHAT` | CONFIG | No | `1` | Page cap for dashboard recent-only imports when old-history backfill is not explicitly selected. Keeps local MTProto imports focused on new messages instead of duplicate-heavy historical pages. | personal-tg |
| `TELEGRAM_IMPORT_WORKER_LOCK_DURATION_MS` | CONFIG | No | `600000` | BullMQ lock duration for Telegram history import jobs. Increase if local imports log lock-renewal errors while pages are still completing. | personal-tg |
| `TELEGRAM_IMPORT_WORKER_STALLED_INTERVAL_MS` | CONFIG | No | `60000` | BullMQ stalled-job scan interval for Telegram history import jobs. | personal-tg |
| `TELEGRAM_IMPORT_WORKER_MAX_STALLED_COUNT` | CONFIG | No | `2` | Number of stalled recoveries allowed before BullMQ fails a Telegram import job. | personal-tg |
| `BOT_TOKEN` | SECRET | Only if `TELEGRAM_BOT_ENABLED=true` | — | Telegram Bot API token from @BotFather. The original bot has been deleted; create a new dedicated test bot for public forks. | pillar6 |
| `TELEGRAM_API_CREDENTIAL_PROVIDER` | CONFIG | Only if `TELEGRAM_MTPROTO_ENABLED=true` | `env` in `.env.example`; `os-keychain` from setup | Controls where the worker reads the Telegram API app credentials from. Use `os-keychain` for normal macOS local use. | personal-tg |
| `TELEGRAM_API_KEYCHAIN_ACCOUNT` | CONFIG | Only if `TELEGRAM_API_CREDENTIAL_PROVIDER=os-keychain` | `telegram-api-credentials` | macOS Keychain account name for the Telegram API app credential JSON. | personal-tg |
| `TELEGRAM_API_ID` | SECRET | Only if `TELEGRAM_MTPROTO_ENABLED=true` and `TELEGRAM_API_CREDENTIAL_PROVIDER=env` | — | Telegram API ID for MTProto (GramJS). Prefer Keychain mode for local personal-account testing. | followup2 |
| `TELEGRAM_API_HASH` | SECRET | Only if `TELEGRAM_MTPROTO_ENABLED=true` and `TELEGRAM_API_CREDENTIAL_PROVIDER=env` | — | Telegram API Hash for MTProto (GramJS). Prefer Keychain mode and treat as high-risk with saved session strings. | followup2 |
| `INTERNAL_AUTH_SECRET` | SECRET | Yes | — | Must match web's value. For Handoff Token verification. | followup1 |
| `PHONE_REDIS_KEY_SECRET` | SECRET | Recommended if Telegram MTProto is enabled | — | HMAC key for Redis phone auth/rate-limit keys. Falls back to `WORKER_INTERNAL_SECRET` or `INTERNAL_AUTH_SECRET`, but a dedicated value reduces cross-secret blast radius. | personal-tg |
| `ADMIN_AI_REPROCESS_CONFIRM_SECRET` | SECRET | Recommended if admin AI reprocess is enabled | — | HMAC key for short-lived dry-run confirmation tokens on `/admin/reprocess-messages`. Falls back to `WORKER_INTERNAL_SECRET` or `INTERNAL_AUTH_SECRET`. | personal-tg |
| `WEB_URL` | CONFIG | Yes | — | Web app URL for JWKS verification (e.g., `https://gordian.yourdomain.com`). | pillar4 |
| `KMS_CMK_ARN` | SECRET | Yes | — | AWS KMS CMK ARN (same as web). | pillar3 |
| `AWS_REGION` | CONFIG | Yes | `us-east-1` | AWS region. | pillar3 |
| `AWS_ACCESS_KEY_ID` | SECRET | Yes | — | AWS IAM credentials. | pillar3 |
| `AWS_SECRET_ACCESS_KEY` | SECRET | Yes | — | AWS IAM credentials. | pillar3 |
| `SUPABASE_URL` | SECRET | Yes | — | Supabase URL (service role — for Realtime Broadcast). | followup3 |
| `SUPABASE_SERVICE_KEY` | SECRET | Yes | — | Supabase service role key. **Never expose to client.** | followup3 |
| `AI_PROCESSING_ENABLED` | CONFIG | No | `false` | Explicit opt-in gate for external AI/embedding vendor egress. Keep false for local demos unless the user understands what leaves the machine. | open-source |
| `NEXT_PUBLIC_LOCAL_AI_PROCESSING_ENABLED` | PUBLIC | No | `false` | Shows local AI analysis controls in the onboarding sync UI without enabling vendor egress. Setup writes `true` for local model presets. | local-ai |
| `AI_SEARCH_EMBEDDINGS_ENABLED` | CONFIG | No | `false` | Optional semantic search embedding gate. Requires either local embeddings or `AI_PROCESSING_ENABLED=true`; search queries are ELM-masked before embedding. | open-source |
| `COMMITMENT_CLOUD_AI_ENABLED` | CONFIG | No | `true` | Allows Claude commitment extraction only when `AI_PROCESSING_ENABLED=true` and `COMMITMENT_LLM_PROVIDER` is not `local` or `disabled`. Local setup writes `false` for Qwen commitment extraction. | local-ai |
| `ANTHROPIC_API_KEY` | SECRET | Conditional | — | Anthropic API key for Claude inference and KG batch extraction when using cloud AI. Used only when `AI_PROCESSING_ENABLED=true`; not required for `KNOWLEDGE_LLM_PROVIDER=local`. | pillar7 |
| `OPENAI_API_KEY_PROVIDER` | CONFIG | No | `env` | Selects OpenAI API key custody: `env` or `os-keychain`. Normal macOS local users should use `os-keychain` via `pnpm openai:setup`. | openai-local |
| `OPENAI_API_KEY` | SECRET | Conditional | — | OpenAI API key for `text-embedding-3-small` when `OPENAI_API_KEY_PROVIDER=env`. Leave blank when using macOS Keychain or `KNOWLEDGE_EMBEDDING_PROVIDER=local`. | followup8 |
| `OPENAI_KEYCHAIN_SERVICE` | CONFIG | No | `gordian-v2` | macOS Keychain service name for the local OpenAI API key when `OPENAI_API_KEY_PROVIDER=os-keychain`. | openai-local |
| `OPENAI_API_KEYCHAIN_ACCOUNT` | CONFIG | No | `openai-api-key` | macOS Keychain account name for the local OpenAI API key when `OPENAI_API_KEY_PROVIDER=os-keychain`. | openai-local |
| `GEMINI_API_KEY` | SECRET | Conditional | — | Gemini API key for default KG inline extraction. Used only when `AI_PROCESSING_ENABLED=true`; not required when `KNOWLEDGE_LLM_PROVIDER=local` or `disabled`. | open-source |
| `KNOWLEDGE_POST_SYNC_ANALYSIS_ENABLED` | CONFIG | No | `true` | Queues workspace knowledge analysis after Telegram imports that insert new messages. Execution still requires KG extraction to be enabled and AI-analysis consent to be persisted. | local-ai |
| `KNOWLEDGE_SYNC_INCREMENTAL_DELAY_MS` | CONFIG | No | `90000` | Debounce delay for small post-sync incremental KG analysis jobs. Jobs dedupe per workspace while waiting/running. | local-ai |
| `KNOWLEDGE_SYNC_INCREMENTAL_CONTACT_LIMIT` | CONFIG | No | `50` | Contact limit for small post-sync incremental KG analysis jobs. | local-ai |
| `KNOWLEDGE_INCREMENTAL_MESSAGES_PER_CONTACT_LIMIT` | CONFIG | No | `200` | Newest-message page size per contact for incremental KG analysis. | local-ai |
| `KNOWLEDGE_IMPORT_COMPLETION_DELAY_MS` | CONFIG | No | `5000` | Delay before KG analysis is queued when a Telegram history import completes with inserted messages. | local-ai |
| `KNOWLEDGE_IMPORT_INCREMENTAL_MESSAGE_THRESHOLD` | CONFIG | No | `100` | Recent imports at or below this inserted-message count queue incremental KG analysis instead of a full completed-import backfill. | local-ai |
| `KNOWLEDGE_IMPORT_INCREMENTAL_CONTACT_LIMIT` | CONFIG | No | `50` | Contact limit for incremental KG analysis after small recent Telegram imports. | local-ai |
| `KNOWLEDGE_IMPORT_FULL_CONTACT_LIMIT` | CONFIG | No | `500` | Contact limit for the completed-import full KG analysis pass. Increase for large first-time imports if local model latency is acceptable. | local-ai |
| `KNOWLEDGE_IMPORT_FULL_MESSAGES_PER_CONTACT_LIMIT` | CONFIG | No | `200` | Historical message page size per contact for completed-import KG backfill continuations. | local-ai |
| `KNOWLEDGE_IMPORT_FULL_MAX_BATCHES` | CONFIG | No | `20` | Maximum continuation batches for a completed-import KG backfill run. | local-ai |
| `KNOWLEDGE_IMPORT_FULL_CONTINUATION_DELAY_MS` | CONFIG | No | `1000` | Delay between resumable completed-import KG backfill batches. | local-ai |
| `KNOWLEDGE_ANALYSIS_WORKER_LOCK_DURATION_MS` | CONFIG | No | `1800000` | BullMQ lock duration for long-running local KG analysis jobs. Increase if local Qwen/Nomic jobs renew too slowly under load. | local-ai |
| `KNOWLEDGE_ANALYSIS_WORKER_STALLED_INTERVAL_MS` | CONFIG | No | `60000` | BullMQ stalled-job scan interval for the KG analysis worker. | local-ai |
| `KNOWLEDGE_ANALYSIS_WORKER_MAX_STALLED_COUNT` | CONFIG | No | `2` | Number of stalled recoveries allowed before BullMQ fails a KG analysis job. | local-ai |
| `AI_EXTRACTION_WORKER_CONCURRENCY` | CONFIG | No | `1` for local commitment LLMs, `3` otherwise | Caps concurrent commitment extraction jobs. Keep `1` for laptop-friendly local Ollama runs so multiple Gemma or Qwen calls do not saturate GPU/RAM. | local-ai |
| `LOCAL_AI_REQUEST_TIMEOUT_MS` | CONFIG | No | `120000` | Timeout for local model HTTP requests before the worker fails/retries the job instead of leaving a model request active indefinitely. | local-ai |
| `LOCAL_AI_OLLAMA_KEEP_ALIVE` | CONFIG | No | `1m` | Native Ollama chat request `keep_alive` value for local chat/commitment/digest-style calls. Use `default` to omit the field and let Ollama use its own default. | local-ai |
| `LOCAL_AI_BENCHMARK_MODELS` | CONFIG | No | `qwen3.5:9b,gemma4:12b-it-q4_K_M` | Comma-separated non-embedding local LLM models compared by `pnpm local-ai:benchmark`. Embeddings are intentionally excluded from this benchmark. | local-ai |
| `LOCAL_AI_BENCHMARK_BASE_URL` | CONFIG | No | `http://localhost:11434` | Native Ollama base URL used by `pnpm local-ai:benchmark`. Must be loopback/private for local-only validation. | local-ai |
| `LOCAL_AI_BENCHMARK_KEEP_ALIVE` | CONFIG | No | `0` | Ollama `keep_alive` value used by the benchmark. The default unloads each model after calls so comparisons do not leave models resident. | local-ai |
| `LOCAL_AI_BENCHMARK_TIMEOUT_MS` | CONFIG | No | `180000` | Per-call timeout for each benchmark case. Increase only when testing larger local models on slower hardware. | local-ai |
| `RELATIONSHIP_EXTRACTION_CONCURRENCY` | CONFIG | No | `1` | Local introduction/new-connection scan worker concurrency. Values are capped from 1 to 4; keep `1` for personal-account testing unless local model latency requires more throughput. | local-ai |
| `RELATIONSHIP_EXTRACTION_WORKER_LOCK_DURATION_MS` | CONFIG | No | `600000` | BullMQ lock duration for local introduction/new-connection relationship extraction jobs. | local-ai |
| `RELATIONSHIP_EXTRACTION_WORKER_STALLED_INTERVAL_MS` | CONFIG | No | `60000` | BullMQ stalled-job scan interval for relationship extraction jobs. | local-ai |
| `RELATIONSHIP_EXTRACTION_WORKER_MAX_STALLED_COUNT` | CONFIG | No | `2` | Number of stalled recoveries allowed before BullMQ fails a relationship extraction job. | local-ai |
| `KNOWLEDGE_EMBEDDING_PROVIDER` | CONFIG | No | `openai` | KG embedding provider: `openai` or `local`. Local mode uses an OpenAI-compatible `/v1/embeddings` endpoint. | local-ai |
| `KNOWLEDGE_EMBEDDING_PRESET` | CONFIG | No | `custom` | Optional local KG embedding preset label. Use `nomic` for the recommended local setup, `qwen` for Qwen embeddings, or `custom` for explicit model settings. The Gemma setup intentionally writes `qwen` here because embeddings remain Qwen-backed. | local-ai |
| `KNOWLEDGE_EMBEDDING_BASE_URL` | CONFIG | No | `https://api.openai.com/v1` | KG embedding base URL. Use `http://localhost:11434/v1` for local OpenAI-compatible servers. | local-ai |
| `KNOWLEDGE_EMBEDDING_MODEL` | CONFIG | No | `text-embedding-3-small` | KG embedding model. Must return 512 dimensions because KG storage is `halfvec(512)`. | local-ai |
| `KNOWLEDGE_EMBEDDING_DIMENSIONS` | CONFIG | No | `512` | Requested KG embedding dimensions. Values other than 512 are rejected. | local-ai |
| `KNOWLEDGE_EMBEDDING_API_KEY` | SECRET | No | — | Optional bearer token for local/proxy embedding endpoints. Omit for local servers that do not require auth. | local-ai |
| `KNOWLEDGE_EMBEDDING_FINGERPRINT` | CONFIG | No | — | Setup-managed compatibility marker containing provider, preset, model, dimensions, and formatting version. `local-ai:doctor` warns if it no longer matches the active embedding runtime. | local-ai |
| `KNOWLEDGE_LLM_PROVIDER` | CONFIG | No | `auto` | KG extraction provider: `auto`, `gemini`, `local`, or `disabled`. Local mode bypasses Anthropic Batch. | local-ai |
| `KNOWLEDGE_LLM_BASE_URL` | CONFIG | No | `http://localhost:11434/v1` | OpenAI-compatible local `/v1/chat/completions` base URL for KG extraction. | local-ai |
| `KNOWLEDGE_LLM_MODEL` | CONFIG | No | `gemma4:12b-it-q4_K_M` | JSON-capable local chat model for KG extraction, such as Gemma or Qwen. | local-ai |
| `KNOWLEDGE_LLM_API_KEY` | SECRET | No | — | Optional bearer token for local/proxy KG LLM endpoints. Omit for local servers that do not require auth. | local-ai |
| `COMMITMENT_LLM_PROVIDER` | CONFIG | No | `cloud` | Commitment extraction provider: `cloud`, `local`, or `disabled`. Use `local` with Qwen or Gemma to avoid vendor egress. | local-ai |
| `COMMITMENT_LLM_API` | CONFIG | No | `ollama` | Local commitment chat API: `ollama` uses native `/api/chat` with `think=false` and JSON Schema format; `openai-compatible` uses `/v1/chat/completions`. | local-ai |
| `COMMITMENT_LLM_BASE_URL` | CONFIG | No | `http://localhost:11434` | Local commitment chat base URL. Must be loopback/private unless `ALLOW_NONLOCAL_AI_ENDPOINTS=true`. | local-ai |
| `COMMITMENT_LLM_MODEL` | CONFIG | No | `gemma4:12b-it-q4_K_M` | JSON-capable local chat model for commitment extraction, relationship health, introduction detection, and new-connection detection. This is independent from the 512-dimensional KG embedding model. | local-ai |
| `COMMITMENT_LLM_API_KEY` | SECRET | No | — | Optional bearer token for local/proxy commitment extraction endpoints. Omit for local servers that do not require auth. | local-ai |
| `COMMITMENT_V2_SHADOW_ENABLED` | CONFIG | No | `true` | Runs the v2 commitment candidate/validator path in shadow mode and emits privacy-safe aggregate route/failure counts without changing stored commitments. Set `false` to disable. | local-ai |
| `COMMITMENT_V2_ACTIVE_AUTOCREATE` | CONFIG | No | `false` | Allows the v2 router to classify exact, high-confidence explicit evidence as active during shadow analysis. Stored local commitments remain draft until the product path is explicitly migrated. | local-ai |
| `CHAT_LLM_PROVIDER` | CONFIG | No | `cloud` | Chat assistant provider: `cloud` or `local`. If unset, chat preserves older behavior by falling back to local `COMMITMENT_LLM_*` when that provider is local. | local-ai |
| `CHAT_LLM_API` | CONFIG | No | `ollama` | Local chat API: `ollama` uses native `/api/chat` with `think=false`; `openai-compatible` uses `/v1/chat/completions`. | local-ai |
| `CHAT_LLM_BASE_URL` | CONFIG | No | `http://localhost:11434` | Local chat base URL. Must be loopback/private unless `ALLOW_NONLOCAL_AI_ENDPOINTS=true`. | local-ai |
| `CHAT_LLM_MODEL` | CONFIG | No | `gemma4:12b-it-q4_K_M` | JSON-capable local chat model for the assistant panel, follow-up drafts, and local deal AI. | local-ai |
| `CHAT_LLM_API_KEY` | SECRET | No | — | Optional bearer token for local/proxy chat endpoints. Omit for local servers that do not require auth. | local-ai |
| `DIGEST_LLM_PROVIDER` | CONFIG | No | `cloud` | Digest provider: `cloud` or `local`. If unset, digest falls back to the chat runtime when local chat is configured. | local-ai |
| `DIGEST_LLM_API` | CONFIG | No | `ollama` | Local digest chat API: `ollama` uses native `/api/chat` with `think=false`; `openai-compatible` uses `/v1/chat/completions`. | local-ai |
| `DIGEST_LLM_BASE_URL` | CONFIG | No | `http://localhost:11434` | Local digest base URL. Must be loopback/private unless `ALLOW_NONLOCAL_AI_ENDPOINTS=true`. | local-ai |
| `DIGEST_LLM_MODEL` | CONFIG | No | `gemma4:12b-it-q4_K_M` | JSON-capable local chat model for digest generation. | local-ai |
| `DIGEST_LLM_API_KEY` | SECRET | No | — | Optional bearer token for local/proxy digest endpoints. Omit for local servers that do not require auth. | local-ai |
| `HELICONE_ENABLED` | CONFIG | No | `false` | Explicit opt-in for Helicone prompt observability. Requires `AI_PROCESSING_ENABLED=true` and `HELICONE_API_KEY`. | open-source |
| `HELICONE_API_KEY` | SECRET | No | — | Helicone observability key. Ignored unless `HELICONE_ENABLED=true`. | followup9 |
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
| `WORKSPACE_KEY_PROVIDER` | CONFIG | No | `dev-insecure` when `DEV_KMS_BYPASS=true`; otherwise `aws-kms` | Selects workspace root-key custody: `os-keychain`, `aws-kms`, or `dev-insecure`. | local-security |
| `WORKSPACE_KEYCHAIN_SERVICE` | CONFIG | Only if `WORKSPACE_KEY_PROVIDER=os-keychain` | `gordian-v2-workspace` | macOS Keychain service for workspace root-key items. Keep separate from Telegram session unwrap keys. | local-security |
| `WORKSPACE_KEY_CACHE_TTL_MINUTES` | CONFIG | No | `5` | Process-local cache TTL for unwrapped workspace root keys, 0-1440 minutes. | local-security |

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
DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5432/gordian_dev"
DRAGONFLY_URL="redis://127.0.0.1:6379"
DEV_KMS_BYPASS="true"
WORKSPACE_KEY_PROVIDER="dev-insecure"
WORKSPACE_KEYCHAIN_SERVICE="gordian-v2-workspace"
WORKSPACE_KEY_CACHE_TTL_MINUTES="60"
SEED_PASSWORD="gordian-demo"
NEXT_PUBLIC_DEMO_LOGIN_ENABLED="true"
NEXT_PUBLIC_DEMO_EMAIL="alice@gordian.dev"
NEXT_PUBLIC_DEMO_PASSWORD="gordian-demo"
NEXT_PUBLIC_APP_URL="http://localhost:3000"
BOT_TOKEN="<test-bot-token>"
TELEGRAM_BOT_ENABLED="false"
TELEGRAM_MTPROTO_ENABLED="false"
TELEGRAM_SEND_ENABLED="false"
TELEGRAM_FULL_BACKFILL_ENABLED="false"
TELEGRAM_PERIODIC_SYNC_ENABLED="false"
NEXT_PUBLIC_TELEGRAM_LINKING_ENABLED="false"
TELEGRAM_SESSION_KEY_PROVIDER="dev-insecure"
TELEGRAM_KEYCHAIN_SERVICE="gordian-v2-telegram"
TELEGRAM_KEYCHAIN_REQUIRE_USER_PRESENCE="false"
TELEGRAM_KEYCHAIN_USER_PRESENCE_MODE="compat"
GORDIAN_KEYCHAIN_HELPER_PATH=""
TELEGRAM_MTPROTO_PER_INTERACTION_UNLOCK="false"
TELEGRAM_MTPROTO_SESSION_IDLE_MINUTES="30"
TELEGRAM_ALLOW_SESSION_UNWRAP_OUTSIDE_IMPORTS="false"
INTERNAL_AUTH_SECRET="<generated by pnpm setup:local>"
WORKER_INTERNAL_SECRET="<generated by pnpm setup:local>"
PHONE_REDIS_KEY_SECRET="<generated by pnpm setup:local>"
ADMIN_AI_REPROCESS_CONFIRM_SECRET="<generated by pnpm setup:local>"
BETTER_AUTH_SECRET="<generated by pnpm setup:local>"
OAUTH_STATE_SECRET="<generated by pnpm setup:local>"
BETTER_AUTH_URL="http://localhost:3000"
WORKER_URL="http://127.0.0.1:3001"
WORKER_HOST="127.0.0.1"
WEB_URL="http://localhost:3000"
CORS_ORIGIN="http://localhost:3000"
NEXT_PUBLIC_SUPABASE_URL="http://localhost:54321"
NEXT_PUBLIC_SUPABASE_ANON_KEY="<local-supabase-anon-key>"
AI_PROCESSING_ENABLED="false"
NEXT_PUBLIC_AI_PROCESSING_ENABLED="false"
SUPABASE_JWT_SECRET="<local-supabase-jwt-secret>"
GOOGLE_CLIENT_ID=""
GOOGLE_CLIENT_SECRET=""
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
