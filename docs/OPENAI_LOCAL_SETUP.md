# OpenAI Local Setup

Gordian can use OpenAI for embeddings that power semantic knowledge search.
External AI/embedding egress is disabled by default. A normal local user should
store the OpenAI API key in macOS Keychain instead of placing it directly in
`.env.local`:

```bash
pnpm openai:setup
```

The wizard opens by pointing users to:

```text
https://platform.openai.com/settings/organization/api-keys
```

Use a restricted API key created for this local install. The interactive prompt
hides the key while typing, writes it to macOS Keychain, and stores only these
non-secret pointers in `.env.local`:

```env
OPENAI_API_KEY_PROVIDER="os-keychain"
OPENAI_KEYCHAIN_SERVICE="gordian-v2"
OPENAI_API_KEYCHAIN_ACCOUNT="openai-api-key"
OPENAI_API_KEY=""
```

Restart the web and worker processes after changing the provider. The server
reads the key from Keychain when it needs embeddings; browser code never receives
the API key.

Setting a key is not enough to enable provider calls. Set
`AI_PROCESSING_ENABLED=true` only when external AI egress is intended. General
CRM search embeddings additionally require `AI_SEARCH_EMBEDDINGS_ENABLED=true`;
queries are ELM-masked before embedding when that path is enabled.

For CI or non-macOS local runs, use:

```env
OPENAI_API_KEY_PROVIDER="env"
OPENAI_API_KEY="sk-..."
```

Keep this mode out of shared screenshots, shell history, and committed files.

## Local Knowledge Graph Models

The knowledge graph can avoid hosted embedding providers with local
OpenAI-compatible endpoints. The recommended user-facing path is the Nomic
preset, with Qwen available as a vector-only preset for proving the embedding
path before larger local JSON extraction models are configured:

```bash
pnpm local-ai:setup:nomic
# or
pnpm local-ai:setup:qwen
```

Then run:

```bash
pnpm kg:local:smoke
```

The local embedding endpoint must return exactly 512 dimensions because the
database schema stores knowledge vectors as `halfvec(512)`. Local LLM extraction
uses `/v1/chat/completions` with JSON-object responses when
`KNOWLEDGE_LLM_PROVIDER=local`; it can also be disabled while validating vectors.
Anthropic Batch is bypassed in local mode; manual knowledge analysis runs
synchronous local calls after the same consent and feature gates.

See `docs/LOCAL_KG_MODELS.md` for the full Nomic and Qwen setup guide, UI
behavior, hardware expectations, validation steps, model-switch fingerprints,
re-embedding guidance, and troubleshooting.

## ChatGPT OAuth

ChatGPT OAuth is not currently a supported general API credential path for this
local app. OpenAI documents ChatGPT OAuth for Codex CLI authentication and Apps
SDK/MCP-style app flows, but Gordian's embedding calls use the OpenAI API. Until
OpenAI provides a documented user OAuth flow for third-party API usage here, the
safe supported option is a user-created API key stored in Keychain.
