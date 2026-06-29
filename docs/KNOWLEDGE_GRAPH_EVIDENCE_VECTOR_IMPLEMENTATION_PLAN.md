# Knowledge Graph Evidence Vector Implementation Plan

Status: Phase 1 implemented and locally verified on `feat/kg-evidence-relationships`
Source inputs:

- `docs/KNOWLEDGE_GRAPH_AUDIT.md`
- `docs/KNOWLEDGE_GRAPH_EVALS.md`
- `docs/LOCAL_KG_MODELS.md`
- Deep Research artifact: `docs/research/privacy-first-local-knowledge-graph-vector-strategy-review.md`
- Current branch: `feat/kg-evidence-relationships`

## Executive Decision

Keep node embeddings at `halfvec(512)`. The next quality improvement is not a
graph-wide dimension migration. It is a separate evidence-vector lane, local
reranking, stricter embedding fingerprints, and evals that measure evidence
recall instead of only node recall.

The target architecture is:

- Confirmed graph for truth.
- Node vectors for entity discovery, dedupe, and clustering.
- Evidence vectors for retrieval, relationship review, and user-facing proof.
- Local reranker for precision.
- Versioned fingerprints for safe migrations.
- Graph-aware summaries later, after evidence retrieval is reliable.

## Current Branch Closeout

This branch was explicitly widened to include the Phase 1 evidence-vector lane
alongside the evidence-gated relationship and local KG quality work.

Implemented in this closeout:

- `knowledge_evidence_chunks` schema and migration with 512-dimensional
  halfvec embeddings, fingerprinting, RLS, provenance refs, and HNSW indexing.
- DAL insert/search APIs for idempotent chunk writes, fingerprint-scoped chunk
  retrieval, and merged node/evidence/chunk search results.
- Worker extraction writes masked evidence chunks for embedding-first matches,
  source-backed LLM entity evidence, and quote-backed relationship evidence.
- `/knowledge` search passes the active embedding fingerprint, returns safe
  masked chunk previews, and renders chunk-match diagnostics in the browser.
- Deterministic DB, worker, and web tests cover chunk insertion, search
  projection, fingerprint-scoped action calls, worker evidence attachment, and
  UI surfacing.

Verified locally:

- `packages/db`: 6 KG test files, 126 tests passed.
- `apps/worker`: 5 KG test files, 75 tests passed.
- `apps/web`: 5 KG test files, 72 tests passed.
- Typecheck passed for `packages/db`, `apps/worker`, and `apps/web`.
- `git diff --check` passed.
- Biome passed on touched Phase 1 files.
- DB-backed migration/search smoke passed on a disposable pgvector 0.8.3
  Postgres 16 database. It verified full migration application,
  `knowledge_evidence_chunks`, HNSW index presence, non-owner RLS isolation,
  idempotent chunk identity, halfvec cosine search, fingerprint filtering, and
  DAL evidence-chunk search projection.
- `local-ai:doctor` passed with local-network access after starting Ollama.
- `kg:local:smoke` passed with Nomic 512 embeddings, Gemma 4 12B KG LLM, and
  Qwen chat model checks.

## What This Branch Already Gives Us

The current work establishes the right guardrails for the next phase:

- `knowledge_evidence` stores message-backed provenance, encrypted snippets,
  contact/message refs, timestamps, relation labels, confidence, and optional
  related node refs.
- `knowledge_relationship_candidates` separates heuristic relationship signals
  from confirmed graph links.
- Relationship promotion is review-oriented and should stay quote-backed.
- Recall evals already check message-backed `/knowledge` behavior, isolation,
  no-confident-result behavior, and evidence projection.
- Local model docs already separate embedding models from chat/extraction roles.
- Gemma 4 12B can be evaluated as an extraction model without forcing embedding
  schema changes.

The remaining gap is that evidence is not yet its own ANN-retrievable vector
memory with a reranked query flow.

## Phase 1: Evidence Chunk Vector Lane

Add a dedicated evidence chunk index as the primary retrieval memory for
message-level proof.

### Schema

Add a new table, tentatively `knowledge_evidence_chunks`, with:

- `id`
- `workspace_id`
- `knowledge_evidence_id`
- `knowledge_node_id`
- `related_knowledge_node_id`
- `contact_id`
- `message_id`
- `chunk_kind`
- `masked_text`
- `source_start_offset`
- `source_end_offset`
- `occurred_at`
- `participants`
- `embedding halfvec(512)`
- `embedding_fingerprint_id` or compatible fingerprint string
- `masking_policy_version`
- `chunking_policy_version`
- `metadata`
- timestamps

Indexing:

- workspace/time/message/contact B-tree indexes for provenance joins.
- HNSW index on `embedding` for the active 512-dimensional lane.
- Partial indexes if multiple fingerprints are allowed in the same table.

Keep snippets encrypted where they may contain message text. Store masked text
only if it is safe enough for retrieval and review.

### Chunking Policy

Start with masked evidence windows, not arbitrary large documents:

- extraction spans
- exact quote windows
- small message windows around known mentions
- manually entered evidence text

Each chunk must be able to stand on its own for retrieval. If a chunk is too
small for display context, the UI can pull neighboring message context at read
time, but the vector row should remain focused.

### DAL And Search Flow

Add evidence chunk search beside existing node search:

1. Exact entity and alias matches.
2. Node-vector neighbors.
3. Evidence-chunk ANN retrieval.
4. Merge candidates by node/contact/message/evidence IDs.
5. Apply lane-specific thresholds.
6. Return evidence-backed results with source provenance.

Do not let evidence-vector similarity promote confirmed links. It can surface
candidate evidence for review only.

### UI

Update `/knowledge` search results to show why a result matched:

- exact or alias match
- node semantic match
- evidence chunk match
- source message timestamp/contact
- relation label
- confidence and evidence kind

Graph mode can continue to show broader topic neighborhoods, but detail panels
should prefer evidence-backed explanations.

## Phase 2: Embedding Fingerprints And Normalization

Formalize a fingerprint policy before comparing embedding models.

Each vector lane needs a versioned compatibility record:

- provider
- preset
- exact model tag
- local packaging/runtime
- dimensions
- metric
- normalization method
- query/document prefix policy
- masking policy version
- chunking policy version
- creation timestamp

Rules:

- Do not compare scores across incompatible fingerprints.
- Do not mix local and cloud embeddings in one ANN lane.
- Store vectors normalized when the model/runtime contract supports it.
- Use one metric per fingerprinted lane.
- Keep active fingerprint selection blue/green so re-embedding is reversible.

Tests:

- dimension smoke
- normalized vector smoke
- prefix behavior smoke
- max-token/context-window smoke
- incompatible fingerprint isolation
- blue/green active fingerprint switching

## Phase 3: Local Reranking

Add reranking after dense retrieval, behind a feature flag.

Initial scope:

- rerank top 30 to 100 evidence chunks
- run only for `/knowledge` evidence search and relationship review
- keep dense-only results as rollback

Candidate models:

- Qwen local reranker, if available in the local runtime
- deterministic scoring fallback for tests

Metrics:

- dense-only versus dense-plus-rerank top-k evidence accuracy
- NDCG or comparable ranking metric on fixture queries
- quote-match and contradiction cases
- unattributed mention cases
- p50/p95 latency
- hardware pressure under local Ollama

Do not block confirmed graph behavior on reranker availability.

## Phase 4: Model Bakeoff

Run model bakeoffs only after the evidence chunk lane exists.

Compare:

- current Nomic 512 path
- Qwen3-Embedding-0.6B shortened to 512
- Nomic v2 MoE truncated to 256 or 512, if practical
- optional OpenAI embeddings for explicit non-sensitive benchmark runs only

Keep Gemma/Qwen chat extraction bakeoffs separate from embedding bakeoffs:

- Gemma and Qwen chat models: KG extraction JSON quality, relationship
  correctness, negation/staleness safety.
- Nomic/Qwen embedding models: node recall, evidence recall, no-result behavior,
  latency, storage, and multilingual/code-heavy retrieval.

Do not migrate `knowledge_nodes.embedding` dimensions as part of the first
evidence-lane bakeoff. If a model wins, apply it to the evidence lane first.

## Phase 5: Graph-Aware Retrieval Later

After evidence retrieval is reliable, add limited graph-aware retrieval:

1. Retrieve relevant entities and evidence chunks.
2. Expand a small ego-network of confirmed edges.
3. Attach supporting evidence to each expanded edge.
4. Suppress stale, contradicted, or candidate-only edges unless explicitly in
   review mode.

This gives the useful local-search part of GraphRAG without adopting full
GraphRAG indexing immediately.

Periodic graph summaries should wait until evidence retrieval and edge
provenance are stable.

## Validation Matrix

Required automated coverage for Phase 1:

| Area | Required checks |
| --- | --- |
| Schema | migration applies, RLS present, workspace isolation, fingerprint constraints |
| Chunking | quote windows, mention windows, manual evidence, neighboring-context lookup |
| ANN recall | exact-vs-HNSW parity, recall@k, filtered-query under-return tests |
| Search behavior | exact + node + evidence fanout, no-confident-result behavior, thresholding |
| Evidence safety | encrypted snippets, safe masked text, no embeddings/raw metadata returned |
| Relationship safety | vector evidence creates review candidates only, no auto-promotion |
| Model runtime | dimension, normalization, prefix, max-token smoke |
| UI | evidence source visible on `/knowledge`, graph detail shows provenance |
| Regression | stale relation, negated relation, unattributed mention, cross-workspace decoy |
| Performance | p50/p95 search latency, reranker latency when enabled |

Runbook commands:

```bash
./node_modules/.bin/vitest run packages/db/src/dal/__tests__/knowledge-relationship-candidates.test.ts packages/db/src/dal/__tests__/knowledge-iterative-scan.test.ts packages/db/src/__tests__/knowledge-recall-quality.test.ts
./node_modules/.bin/vitest run apps/worker/src/ai/__tests__/knowledge-extraction.test.ts apps/worker/src/ai/__tests__/knowledge-inference.test.ts apps/worker/src/ai/__tests__/knowledge-llm.test.ts scripts/lib/local-ai-benchmark-relations.test.mjs
./node_modules/.bin/vitest run --config apps/web/vitest.config.ts apps/web/src/__tests__/actions/knowledge.test.ts apps/web/src/app/\(dashboard\)/knowledge/knowledge-browser.test.tsx apps/web/src/components/knowledge/knowledge-graph.test.tsx apps/web/src/components/local-ai-status-panel.test.tsx
./node_modules/.bin/tsc --noEmit -p packages/db/tsconfig.json
./node_modules/.bin/tsc --noEmit -p apps/worker/tsconfig.json
./node_modules/.bin/tsc --noEmit -p apps/web/tsconfig.json
```

Optional live checks when local services are available:

```bash
pnpm local-ai:doctor
pnpm kg:local:smoke
pnpm kg:recall:pg:smoke
```

## Rollout And Rollback

Roll out in lanes:

1. Write chunks without serving them.
2. Serve evidence chunk search behind a feature flag.
3. Compare evidence-lane results against current node-only behavior.
4. Enable evidence-lane results in `/knowledge`.
5. Enable reranking for review surfaces only.
6. Expand to user-facing high-confidence evidence search.

Rollback:

- disable evidence-lane search flag
- keep node-only search path active
- leave chunk rows in place for debugging
- keep old fingerprint active until blue/green cutover passes evals

## Open Questions

- Should `masked_text` be plaintext masked text, encrypted masked text, or both
  with a generated search-safe projection?
- Should evidence chunks be owned by `knowledge_evidence` only, or should they
  also support message chunks before an evidence row exists?
- Which local reranker is practical on the target hardware?
- Should `knowledge_evidence` be extended directly, or should chunk embeddings
  stay in a separate table to avoid mixing provenance rows with retrieval rows?
- What is the first accepted latency budget for `/knowledge` evidence search?
