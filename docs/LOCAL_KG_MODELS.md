# Local Knowledge Graph Models

This guide explains how to run the knowledge graph with local models. The
recommended path is the Nomic preset through Ollama. It keeps Nomic
512-dimensional embeddings and now uses Gemma 4 12B for non-embedding local LLM
roles. Qwen is available as a vector-focused preset for proving stronger
multilingual, technical, or code-heavy retrieval without changing the KG vector
shape.

## What Runs Locally

The knowledge graph uses two model paths:

| Path | Endpoint | Output | Purpose |
| --- | --- | --- | --- |
| Embeddings | `/v1/embeddings` | 512-number vectors | Semantic search and node dedupe |
| KG chat | `/v1/chat/completions` | JSON text | Extract knowledge entities from messages |
| Commitment chat | `/api/chat` | JSON text | Extract short-term commitments from messages |

The chat model does not need a vector dimension. It only needs to return valid
JSON. The embedding model must return exactly 512 numbers because the current
database schema stores knowledge vectors as `halfvec(512)`.

Qwen setup keeps knowledge-graph chat extraction disabled by default. It can
still configure local commitment extraction because commitments use a separate
chat-model setting and do not affect the 512-dimensional KG vector schema.
Gemma setup keeps Qwen embeddings but routes all non-embedding local LLM roles to
Gemma 4 12B so the app can compare Gemma and Qwen without changing vector
storage.

## Quickstart: Nomic

Install Ollama, start it, then run:

```bash
pnpm local-ai:setup:nomic
```

That command:

1. creates or updates `.env.local`,
2. configures local KG embeddings and local KG chat extraction,
3. pulls `nomic-embed-text` and `gemma4:12b-it-q4_K_M` with Ollama,
4. runs `pnpm kg:local:smoke`.

If the models are already pulled and you only want to write env values:

```bash
pnpm local-ai:setup:nomic -- --skip-pull
```

If Ollama is not running yet:

```bash
ollama serve
```

Then rerun:

```bash
pnpm kg:local:smoke
```

## Quickstart: Qwen Vectors And Commitments

Qwen uses the same local OpenAI-compatible embedding endpoint for KG vectors, and
a separate native Ollama Qwen chat model for commitment extraction:

```bash
pnpm local-ai:setup:qwen
```

That writes Qwen vector preset values, pulls:

```bash
ollama pull qwen3-embedding:0.6b
ollama pull qwen3.5:4b
```

and runs the same smoke test. With the default Qwen preset, the smoke verifies
`/v1/embeddings` returns exactly 512 dimensions and skips the KG JSON extraction
check because `KNOWLEDGE_LLM_PROVIDER` is disabled. Commitment extraction uses
`COMMITMENT_LLM_PROVIDER=local`, `COMMITMENT_LLM_API=ollama`, and
`COMMITMENT_LLM_MODEL=qwen3.5:4b` instead. Chat uses the separate
`CHAT_LLM_*` keys, and setup writes them to the same Qwen model by default. If
you already have a supported Qwen commitment/chat model installed locally, setup
will reuse it before pulling the preset default.
Local Qwen extraction is review-first: accepted items are stored as drafts unless
the user promotes them.

```bash
pnpm kg:local:smoke
```

If you already have the models:

```bash
pnpm local-ai:setup:qwen -- --skip-pull
```

## Quickstart: Gemma 4 12B LLMs

Gemma setup compares or runs Gemma 4 12B across non-embedding local LLM roles. It
intentionally keeps Qwen embeddings because the knowledge graph schema stores
512-dimensional vectors and the Qwen embedding preset has already been validated
for that shape.

```bash
pnpm local-ai:setup:gemma
```

That writes Qwen vector preset values, pulls:

```bash
ollama pull qwen3-embedding:0.6b
ollama pull gemma4:12b-it-q4_K_M
```

and routes these non-embedding roles to Gemma:

```env
KNOWLEDGE_LLM_PROVIDER="local"
KNOWLEDGE_LLM_MODEL="gemma4:12b-it-q4_K_M"

COMMITMENT_LLM_PROVIDER="local"
COMMITMENT_LLM_MODEL="gemma4:12b-it-q4_K_M"

CHAT_LLM_PROVIDER="local"
CHAT_LLM_MODEL="gemma4:12b-it-q4_K_M"

DIGEST_LLM_PROVIDER="local"
DIGEST_LLM_MODEL="gemma4:12b-it-q4_K_M"
```

Relationship health, introduction detection, new-connection detection, local
follow-up drafts, deal local AI, chat, digest, commitment extraction, and KG JSON
extraction all use one of those local LLM role settings. Embeddings remain on
`qwen3-embedding:0.6b`.

## Nomic Preset Values

The setup command writes these KG model settings:

```env
KNOWLEDGE_EMBEDDING_PROVIDER="local"
KNOWLEDGE_EMBEDDING_PRESET="nomic"
KNOWLEDGE_EMBEDDING_BASE_URL="http://localhost:11434/v1"
KNOWLEDGE_EMBEDDING_MODEL="nomic-embed-text"
KNOWLEDGE_EMBEDDING_DIMENSIONS="512"
KNOWLEDGE_EMBEDDING_API_KEY=""
KNOWLEDGE_EMBEDDING_FINGERPRINT="local:local:nomic:nomic-embed-text:512:kg-embedding-format-v1"

KNOWLEDGE_LLM_PROVIDER="local"
KNOWLEDGE_LLM_BASE_URL="http://localhost:11434/v1"
KNOWLEDGE_LLM_MODEL="gemma4:12b-it-q4_K_M"
KNOWLEDGE_LLM_API_KEY=""
```

The default non-embedding local LLM is Gemma 4 12B for richer KG extraction, commitment extraction, chat, and digest output. You can override it:

```bash
pnpm local-ai:setup -- --preset nomic --llm-model your-chat-model:tag
```

You can also override the base URL if a proxy or different local runtime exposes
OpenAI-compatible endpoints:

```bash
pnpm local-ai:setup -- --preset nomic --base-url http://localhost:1234/v1
```

## Qwen Preset Values

The Qwen setup command writes these KG model settings:

```env
KNOWLEDGE_EMBEDDING_PROVIDER="local"
KNOWLEDGE_EMBEDDING_PRESET="qwen"
KNOWLEDGE_EMBEDDING_BASE_URL="http://localhost:11434/v1"
KNOWLEDGE_EMBEDDING_MODEL="qwen3-embedding:0.6b"
KNOWLEDGE_EMBEDDING_DIMENSIONS="512"
KNOWLEDGE_EMBEDDING_API_KEY=""
KNOWLEDGE_EMBEDDING_FINGERPRINT="local:local:qwen:qwen3-embedding:0.6b:512:kg-embedding-format-v1"

KNOWLEDGE_LLM_PROVIDER="disabled"
KNOWLEDGE_LLM_BASE_URL=""
KNOWLEDGE_LLM_MODEL=""
KNOWLEDGE_LLM_API_KEY=""

COMMITMENT_CLOUD_AI_ENABLED="false"
COMMITMENT_LLM_PROVIDER="local"
COMMITMENT_LLM_API="ollama"
COMMITMENT_LLM_BASE_URL="http://localhost:11434"
COMMITMENT_LLM_MODEL="qwen3.5:4b"
COMMITMENT_LLM_API_KEY=""

CHAT_LLM_PROVIDER="local"
CHAT_LLM_API="ollama"
CHAT_LLM_BASE_URL="http://localhost:11434"
CHAT_LLM_MODEL="qwen3.5:4b"
CHAT_LLM_API_KEY=""
```

Use Qwen when retrieval quality and local commitment extraction are the things
being tested. Use Nomic when you want the default end-to-end local KG path,
including local KG JSON extraction.

Local JSON extraction can be enabled later by explicitly providing a chat model:

```bash
pnpm local-ai:setup -- --preset qwen --llm-model llama3.1:8b
```

That larger-model path is separate from proving the vector setup.

To keep Qwen vector setup only and skip local commitment extraction:

```bash
pnpm local-ai:setup:qwen -- --skip-commitment-llm
```

## Gemma Preset Values

The Gemma setup command writes the Qwen embedding settings plus Gemma LLM role
settings:

```env
KNOWLEDGE_EMBEDDING_PROVIDER="local"
KNOWLEDGE_EMBEDDING_PRESET="qwen"
KNOWLEDGE_EMBEDDING_BASE_URL="http://localhost:11434/v1"
KNOWLEDGE_EMBEDDING_MODEL="qwen3-embedding:0.6b"
KNOWLEDGE_EMBEDDING_DIMENSIONS="512"
KNOWLEDGE_EMBEDDING_API_KEY=""
KNOWLEDGE_EMBEDDING_FINGERPRINT="local:local:qwen:qwen3-embedding:0.6b:512:kg-embedding-format-v1"

KNOWLEDGE_LLM_PROVIDER="local"
KNOWLEDGE_LLM_BASE_URL="http://localhost:11434/v1"
KNOWLEDGE_LLM_MODEL="gemma4:12b-it-q4_K_M"
KNOWLEDGE_LLM_API_KEY=""

COMMITMENT_CLOUD_AI_ENABLED="false"
COMMITMENT_LLM_PROVIDER="local"
COMMITMENT_LLM_API="ollama"
COMMITMENT_LLM_BASE_URL="http://localhost:11434"
COMMITMENT_LLM_MODEL="gemma4:12b-it-q4_K_M"
COMMITMENT_LLM_API_KEY=""

CHAT_LLM_PROVIDER="local"
CHAT_LLM_API="ollama"
CHAT_LLM_BASE_URL="http://localhost:11434"
CHAT_LLM_MODEL="gemma4:12b-it-q4_K_M"
CHAT_LLM_API_KEY=""

DIGEST_LLM_PROVIDER="local"
DIGEST_LLM_API="ollama"
DIGEST_LLM_BASE_URL="http://localhost:11434"
DIGEST_LLM_MODEL="gemma4:12b-it-q4_K_M"
DIGEST_LLM_API_KEY=""
```

## Hardware Guidance

These are practical local-development expectations, not hard product limits:

| Preset | Best for | Practical machine guidance |
| --- | --- | --- |
| Nomic | Default local embeddings plus an 8B chat model | Modern laptop, 16 GB RAM preferred, CPU works but GPU/Apple Silicon is smoother |
| Qwen | Vector-only technical or multilingual retrieval experiments | Modern laptop; the default pull is the 0.6B embedding model, not an 8B chat model |
| Gemma | Gemma 4 12B comparison across non-embedding LLM roles with Qwen embeddings | 24 GB RAM recommended; keep model concurrency low and unload idle models quickly |

Embedding calls are usually short and cheap compared with chat extraction. The
chat model is the heavier part because it must read message batches and produce
JSON entities.

## Model Tradeoffs

| Choice | Strengths | Tradeoffs |
| --- | --- | --- |
| Nomic embed | Lightweight, explicit 512-dim Matryoshka-style use, easy default for local installs | Less specialized for multilingual or code-heavy retrieval than larger embedding models |
| Qwen embed | Stronger technical and multilingual retrieval potential | Larger than Nomic embed and may be slower locally, but Ollama `qwen3-embedding:0.6b` has been validated to return 512 dimensions |
| Custom OpenAI-compatible embed | Lets advanced users run LM Studio, TEI, or another local/proxy server | User must prove it returns exactly 512 dimensions and should re-embed after any model change |

## Validation

Run the lightweight env doctor:

```bash
pnpm local-ai:doctor
```

Run the live endpoint smoke:

```bash
pnpm kg:local:smoke
```

The smoke checks:

- local mode is enabled for KG embeddings;
- `/v1/models` is reachable when the server supports it;
- `/v1/embeddings` returns exactly 512 dimensions;
- `/v1/chat/completions` returns parseable JSON with an `entities` array when
  `KNOWLEDGE_LLM_PROVIDER=local`.

The smoke does not require OpenAI, Gemini, or Anthropic keys when KG embeddings
are local and KG LLM extraction is either local or disabled.

Run the non-embedding model parity benchmark when comparing Qwen and Gemma:

```bash
pnpm local-ai:benchmark
```

By default it compares:

```env
LOCAL_AI_BENCHMARK_MODELS="qwen3.5:9b,gemma4:12b-it-q4_K_M"
```

The benchmark runs representative local-only prompts for chat, digest,
commitment extraction, follow-up drafting, knowledge extraction, introduction
detection, new-connection detection, relationship health, and deal brief
generation. It validates JSON shape, source IDs, exact quote grounding where
relevant, and latency. It does not call embedding endpoints or cloud providers.

To focus a comparison on a specific feature family, pass benchmark case names:

```bash
pnpm local-ai:benchmark -- --cases introduction_detection,new_connection_detection
```

## UI Behavior

There is no model-picker UI today. Local model selection is an operator/local-dev
configuration step through `.env.local`.

The dashboard knowledge page does reflect the active provider in its local
analysis estimate. With the Nomic preset configured, the local analysis panel
shows:

- `Nomic local embeddings` for the vector path;
- `Qwen local embeddings` when the Qwen preset is active;
- `local LLM` for the JSON extraction path;
- `LLM disabled` when using the default Qwen vector-only preset;
- the estimated number of embedding inputs and LLM calls.

The Run analysis button still uses the same feature and consent gates. Local
mode only changes where the embedding and entity-extraction calls go.

## Post-Sync Graph Builds

Telegram history imports schedule KG work automatically when
`KNOWLEDGE_POST_SYNC_ANALYSIS_ENABLED` is not `false`.

- Pages that insert new messages queue a debounced incremental job for the
  workspace. The default debounce is `KNOWLEDGE_SYNC_INCREMENTAL_DELAY_MS=90000`
  and the default contact limit is `KNOWLEDGE_SYNC_INCREMENTAL_CONTACT_LIMIT=50`.
- A completed history import with inserted messages queues one full workspace
  analysis job keyed by the import run id. The default delay is
  `KNOWLEDGE_IMPORT_COMPLETION_DELAY_MS=5000` and the default contact limit is
  `KNOWLEDGE_IMPORT_FULL_CONTACT_LIMIT=500`.
- Full import analysis is resumable per contact. Each run scans up to
  `KNOWLEDGE_IMPORT_FULL_MESSAGES_PER_CONTACT_LIMIT=200` messages per contact,
  records the oldest message reached in `knowledge_extraction_log`, and queues
  a continuation batch while historical messages remain. Continuations are
  capped by `KNOWLEDGE_IMPORT_FULL_MAX_BATCHES=20` with
  `KNOWLEDGE_IMPORT_FULL_CONTINUATION_DELAY_MS=1000` between batches.
- Incremental sync analysis keeps the cheaper newest-message path and defaults
  to `KNOWLEDGE_INCREMENTAL_MESSAGES_PER_CONTACT_LIMIT=200` messages per
  contact.
- The KG jobs carry workspace/run metadata only. They do not carry Telegram
  session material or message plaintext. The Telegram import session is
  disconnected at import finalization; KG analysis reads encrypted local
  message rows through the workspace envelope and still requires persisted AI
  analysis consent plus the `knowledge_extraction` feature flag or
  `KNOWLEDGE_EXTRACTION_ENABLED=true`.

`KNOWLEDGE_AUTO_ANALYSIS_ENABLED` still controls the old 24-hour cron. It is not
required for post-sync graph builds.

## Why 512 Dimensions

The database stores KG vectors as `halfvec(512)`. That is efficient for local
storage and search, but every embedding must be exactly 512 numbers.

If the local endpoint returns 768 dimensions, the app rejects it. Do not mix
embedding models or dimensions in the same knowledge graph; vectors from
different models are not comparable. If you switch embedding models later, plan
to re-embed the KG.

## Embedding Input Formatting

The app formats local embedding inputs by retrieval side:

| Preset | Stored node and dedup inputs | Search query inputs |
| --- | --- | --- |
| Nomic | `search_document: Solana DePIN infrastructure` | `search_query: who knows about DePIN?` |
| Qwen | raw masked node text | `Instruct: Retrieve relevant knowledge graph entities and contacts.\nQuery: who knows about DePIN?` |
| Custom/cloud | raw masked text | raw masked text |

This matters because some embedding models were trained to treat indexed
documents and user queries differently. The app still masks entity-like text
before embedding; formatting is added after masking.

## Fingerprints and Re-embedding

`KNOWLEDGE_EMBEDDING_FINGERPRINT` is a setup-managed compatibility marker. It
records:

- provider and mode, such as `local`;
- preset, such as `nomic` or `qwen`;
- embedding model name;
- vector dimension count;
- app-side embedding formatting version.

New KG nodes also store this fingerprint in node metadata. `pnpm local-ai:doctor`
warns when the fingerprint in `.env.local` does not match the active embedding
runtime. The worker logs a warning if it sees an existing node whose stored
fingerprint differs from the active runtime.

If you switch from Nomic to Qwen, or from Qwen to a custom embedding model, old
vectors remain in the old model space. They may still be 512 numbers, but they
are not directly comparable to vectors from the new model. The practical local
path is:

1. Stop web and worker processes.
2. Run `pnpm local-ai:setup -- --preset <new-preset>`.
3. Rebuild or re-run KG analysis for the affected local workspace so nodes are
   embedded with the new model.
4. Run `pnpm kg:local:smoke`.
5. Run the KG recall checks you care about, such as `pnpm kg:recall:quality` or
   `pnpm kg:recall:pg:smoke` when local Postgres is available.

There is not yet a one-command workspace-scoped KG re-embed CLI. For an
open-source local install, the simplest full reset is often to reset the local
demo database and sync/analyze again. For an existing local workspace, use the
manual knowledge analysis controls after switching presets, and treat search
quality as untrusted until the old nodes have been re-embedded.

## Troubleshooting

| Symptom | Meaning | Fix |
| --- | --- | --- |
| `not reachable at localhost:11434` | Ollama is not running | Start Ollama or run `ollama serve` |
| `model not found` | Ollama has not pulled the model | Run `ollama pull nomic-embed-text` and `ollama pull gemma4:12b-it-q4_K_M` |
| Qwen `model not found` | Ollama has not pulled the Qwen embedding model | Run `ollama pull qwen3-embedding:0.6b` |
| `returned 768 dimensions` | The embedding server ignored the 512-dim request | Use the Nomic preset and confirm the server supports 512-dim output |
| `LLM response did not include entities array` | Chat model did not return the expected JSON shape | This only applies when local JSON extraction is enabled; use `gemma4:12b-it-q4_K_M`, reduce custom model temperature, or try another stronger local chat model |
| `KNOWLEDGE_EMBEDDING_FINGERPRINT` warning | `.env.local` no longer matches the active embedding model/preset | Re-run setup for the intended preset, then re-embed the KG before trusting semantic search |
| Search quality changes after a model switch | Existing vectors were produced by another model | Re-embed the KG before comparing results |

## What Is Not Bundled

The repository does not bundle model weights. Model files are large and have
their own licenses and update cadence. The setup command pulls them into the
local model runtime instead.
