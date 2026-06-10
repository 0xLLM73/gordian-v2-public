# AI Egress Inventory

This inventory tracks source files that can initiate, proxy, configure, or call
AI model and embedding egress. It is enforced by
`pnpm ai:egress:audit`, which scans for provider SDKs, inference helpers,
embedding helpers, OpenAI-compatible model endpoints, Helicone egress, and the
worker embedding handoff.

## Privacy Contract

- External vendor AI egress is disabled by default. Cloud inference and cloud
  embeddings require `AI_PROCESSING_ENABLED=true`.
- Search query embeddings additionally require `AI_SEARCH_EMBEDDINGS_ENABLED=true`.
- Local model endpoints are allowed without vendor egress only when configured
  as local/private endpoints. Remote endpoints pretending to be local are
  rejected unless `ALLOW_NONLOCAL_AI_ENDPOINTS=true`.
- AI analysis over imported Telegram/user context requires saved AI-analysis
  consent before worker jobs run.
- Embedding inputs must be ELM-masked or reduced to non-sensitive labels before
  `generateEmbedding()` or `generateEmbeddings()` is called.
- Helicone is prompt observability. It stays off unless `HELICONE_ENABLED=true`,
  `HELICONE_API_KEY` is configured, and vendor AI egress is enabled.
- Browser status surfaces must describe the active posture truthfully: local
  search, masked embedding, no embedding request, local worker unavailable, or
  vendor AI disabled.

## Inventory Rules

- Add a row here when a PR adds a new provider SDK, direct model endpoint, model
  request helper, embedding helper call site, or worker route that can trigger AI
  processing.
- Keep the path in backticks so `scripts/ai-egress-inventory-audit.mjs` can
  verify it.
- Prefer central helpers (`inferWithCache`, `inferWithGemini`,
  `generateEmbedding`, `generateEmbeddings`, and local runtime helpers) over new
  direct provider calls.
- If a new path sends user-derived text to a cloud provider, include the gate
  and masking/consent story in the row before merging.

## Runtime And Browser Boundaries

| Path | Egress class | Gate and masking notes |
| --- | --- | --- |
| `apps/web/src/app/actions/knowledge.ts` | Web knowledge embedding and worker handoff | Uses `getKnowledgeEmbeddingRuntime`; cloud embeddings require `AI_PROCESSING_ENABLED=true`; local embeddings can run through configured local/private OpenAI-compatible endpoints. Knowledge search queries are masked before embedding. |
| `apps/web/src/app/actions/search.ts` | Web search embedding handoff | Requires `AI_SEARCH_EMBEDDINGS_ENABLED=true`; cloud embedding handoff is blocked when vendor egress is disabled; local embeddings are allowed through worker `/admin/embed`; raw queries are ELM-masked before handoff. |
| `apps/worker/src/routes/admin.ts` | Worker admin embedding route | `/admin/embed` requires the internal secret, rejects cloud embeddings unless `AI_PROCESSING_ENABLED=true`, then uses `generateEmbedding()` for runtime gating and input safety. |
| apps/web/src/components/search/search-interface.tsx | Browser provenance display | Displays whether search used masked semantic embeddings or text/exact search only. This file is not a provider caller but is the required user-visible status surface for search egress. |
| apps/web/src/components/local-ai-status-panel.tsx | Browser runtime status display | Displays configured local/cloud/disabled model roles. This file is not a provider caller but is the required user-visible status surface for model posture. |

## Central Provider Adapters

| Path | Egress class | Gate and masking notes |
| --- | --- | --- |
| `apps/worker/src/ai/cached-inference.ts` | Anthropic Claude and optional Helicone | Central Claude helper. `inferWithCache()` and `streamInfer()` require `assertAiProcessingEnabled(...)`; Helicone proxy headers only appear when Helicone is explicitly enabled. |
| `apps/worker/src/ai/gemini-inference.ts` | Gemini | Central Gemini helper. `inferWithGemini()` requires `assertAiProcessingEnabled(...)`; callers must pass ELM-masked prompt content. |
| `apps/worker/src/ai/embeddings.ts` | OpenAI-compatible embeddings, cloud or local | Central embedding helper. Cloud embeddings require `AI_PROCESSING_ENABLED=true`; local embeddings use `getKnowledgeEmbeddingRuntime`. Raw emails, phones, Telegram handles, and wallet-like values are rejected before request. |
| `apps/worker/src/ai/local-chat.ts` | Local chat LLM | Uses `getChatLlmRuntime`; only runs when chat runtime mode is local. Supports Ollama and OpenAI-compatible local/private endpoints. |
| `apps/worker/src/ai/knowledge-llm.ts` | Knowledge LLM, Gemini or local | Uses `getKnowledgeLlmRuntime`; local mode calls local/private OpenAI-compatible chat endpoints; Gemini mode uses the gated Gemini helper. |
| `packages/shared/src/knowledge-ai.ts` | Knowledge embedding and LLM runtime config | Builds cloud/local runtime URLs, validates 512-dimensional embeddings, labels Nomic/Qwen/custom presets, and rejects nonlocal local-AI endpoints unless explicitly allowed. |
| `packages/shared/src/chat-ai.ts` | Local chat runtime config | Builds Ollama or OpenAI-compatible local chat URLs and rejects nonlocal local-AI endpoints unless explicitly allowed. |
| `packages/shared/src/commitment-ai.ts` | Local commitment runtime config | Builds Ollama or OpenAI-compatible local commitment chat URLs and rejects nonlocal local-AI endpoints unless explicitly allowed. |
| `packages/shared/src/deal-local-ai.ts` | Deal local AI runtime and deterministic fallback | Uses local Ollama/OpenAI-compatible runtime only when live local deal AI is explicitly enabled; deterministic fallback avoids provider egress. |

## Worker Feature Call Sites

| Path | Egress class | Gate and masking notes |
| --- | --- | --- |
| `apps/worker/src/ai/batch-relationship.ts` | Relationship extraction batch/fallback plus embeddings | Uses cloud Anthropic batch only when knowledge LLM runtime is cloud and vendor egress is enabled; local/Gemini paths use their configured adapters; embeddings use masked/dedup inputs. |
| `apps/worker/src/ai/chat-stream.ts` | Chat assistant streaming | Uses Claude helpers for cloud chat and local chat helper when configured. Imported-message chat remains consent/runtime gated at route/action layers. |
| `apps/worker/src/ai/chat-tools.ts` | Chat tool semantic lookups | Uses embedding helper for masked semantic tool queries. Tool results must not expose raw internal IDs unless explicitly requested. |
| `apps/worker/src/ai/chat.ts` | Chat assistant non-streaming | Uses `inferWithCache()` for cloud chat and is blocked by the central vendor egress gate. |
| `apps/worker/src/ai/commitment-extraction.ts` | Commitment extraction, cloud or local | Cloud Claude paths require vendor egress; local Qwen/Ollama paths stay local; message content is masked before model calls where local/cloud extraction expects masked context. |
| `apps/worker/src/ai/connection-detection.ts` | Connection detection, cloud or local | Cloud Claude paths require vendor egress; local runtime paths use local/private chat endpoints; prompt inputs must be masked before model calls. |
| `apps/worker/src/ai/contact-summary.ts` | Contact summary | Uses `inferWithCache()` and masks user-derived context before prompt construction. |
| `apps/worker/src/ai/deal-classifier.ts` | Deal classifier | Uses the gated Gemini helper for cloud classification. |
| `apps/worker/src/ai/deal-extraction.ts` | Deal extraction | Uses the gated Gemini helper for cloud extraction. |
| `apps/worker/src/ai/digest.ts` | Digest generation, cloud or local | Uses Claude helper for cloud digest generation or local Ollama/OpenAI-compatible endpoints when configured; imported-message digest generation remains consent/runtime gated. |
| `apps/worker/src/ai/draft-generation.ts` | Draft generation local runtime | Uses local chat runtime endpoints for draft generation; outbound sends remain separate and disabled by default. |
| `apps/worker/src/ai/fulfillment-detection.ts` | Fulfillment detection | Direct Haiku client guarded by `assertAiProcessingEnabled(...)`; message content is ELM-masked before the provider call. |
| `apps/worker/src/ai/goal-decomposition.ts` | Goal decomposition | Direct Haiku client guarded by `assertAiProcessingEnabled(...)`; inputs are GraphRAG/goal context and must already be ELM-masked. |
| `apps/worker/src/ai/goal-extraction.ts` | Goal extraction | Direct Haiku client guarded by `assertAiProcessingEnabled(...)`; message content is redacted or ELM-masked before prompt construction. |
| `apps/worker/src/ai/helicone-feedback.ts` | Helicone feedback | Sends reward metadata to Helicone only when the caller explicitly records provider feedback. Do not include prompt bodies or raw messages. |
| `apps/worker/src/ai/introduction-detection.ts` | Introduction detection, cloud or local | Uses cloud Claude or local chat runtime depending on config; cloud paths require vendor egress and prompt inputs must be masked. |
| `apps/worker/src/ai/knowledge-extraction.ts` | Knowledge extraction and KG embeddings | Uses cached embedding helper on masked knowledge inputs; LLM extraction uses configured KG LLM runtime. |
| `apps/worker/src/ai/morning-brief.ts` | Morning brief and reminder embeddings | Uses Claude helper for cloud brief generation and embedding helper for masked or low-sensitivity retrieval labels. |
| `apps/worker/src/ai/outcome-evaluators.ts` | Outcome scoring embeddings | Embeds constrained context labels instead of raw message content. |
| `apps/worker/src/ai/precedents.ts` | Precedent search embeddings | Embeds masked query text through the central embedding helper. |
| `apps/worker/src/ai/rationale-extraction.ts` | Rationale extraction and embeddings | Uses gated Gemini helper and central embedding helper with masked decision/rationale inputs. |
| `apps/worker/src/ai/recommendations.ts` | Recommendations embeddings | Embeds masked recommendation context through the central embedding helper. |
| `apps/worker/src/ai/relationship-extraction.ts` | Relationship extraction | Uses `inferWithCache()` and is blocked by the central vendor egress gate. |
| `apps/worker/src/ai/relationship-health.ts` | Relationship-health local runtime | Uses local chat runtime endpoints; keep remote local-AI override disabled for normal local/public use. |
| `apps/worker/src/ai/semantic-cache.ts` | Semantic cache embeddings | Embeds masked semantic-cache queries through the central embedding helper. |
| `apps/worker/src/ai/style-ai-analysis.ts` | Style AI analysis | Uses the gated Gemini helper. Prompt content must be masked or user-consented calibration context. |
| `apps/worker/src/ai/token-detection.ts` | Token detection | Uses `inferWithCache()` and is blocked by the central vendor egress gate. |

## Queue Call Sites

| Path | Egress class | Gate and masking notes |
| --- | --- | --- |
| `apps/worker/src/queues/ai-flow.ts` | AI extraction and embedding orchestration | Embedding helper calls use masked titles/context; the queue should run only after consent/runtime gates have allowed analysis. |
| `apps/worker/src/queues/backfill.ts` | Memory embedding backfill | Applies masking before embedding and uses the central embedding helper. |
| `apps/worker/src/queues/decision-recording.ts` | Decision graph embeddings | Embeds masked decision context through the central embedding helper. |
| `apps/worker/src/queues/diff-embedding.ts` | Correction diff embeddings | Embeds sanitized correction-diff text through the central embedding helper. |
| `apps/worker/src/queues/goal-decomposition.ts` | Goal decomposition queue embeddings | Embeds masked goal titles/context before queuing decomposition work. |
| `apps/worker/src/queues/knowledge-cron.ts` | Knowledge analysis orchestration | Uses configured KG LLM helpers for cloud/local extraction and should only run after feature, consent, and runtime checks. |
| `apps/worker/src/queues/pattern-aggregation.ts` | Pattern aggregation | Uses `inferWithCache()` and is blocked by the central vendor egress gate. |

## Manual And Setup Scripts

| Path | Egress class | Gate and masking notes |
| --- | --- | --- |
| `scripts/backfill-knowledge-embeddings.mjs` | One-time KG embedding repair | Uses the central embedding helper after masking reconstructed node input. Cloud mode requires `AI_PROCESSING_ENABLED=true`; local Nomic/Qwen embeddings remain supported. |
| `scripts/batch-sim.ts` | Manual live learning simulation | Uses worker embedding and model helpers. Treat as a developer-only live API simulation, not a default release path. Use `--dry-run` when provider calls are not intended. |
| `scripts/e2e-loop.ts` | Manual live recursive-learning simulation | Uses worker embedding and model helpers against seeded data. Treat as developer-only and do not run in public/demo defaults. |
| `scripts/kg-local-smoke.mjs` | Local KG runtime smoke | Calls local embeddings/chat endpoints to verify Nomic/Qwen/local setup. It should target localhost/private model endpoints only. |
| `scripts/test-phase4.ts` | Legacy manual integration script | Uses worker embedding helper and live database fixtures. Treat as developer-only and avoid running against user data without the same cloud/local egress controls. |
