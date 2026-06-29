# Knowledge Graph Model Eval And Reranking Implementation Plan

Status: ready after Phase 1 evidence chunks

Current Phase 2 slice:

- `pnpm kg:model:eval`
- `scripts/knowledge-model-eval.ts`
- `scripts/lib/knowledge-model-eval.ts`
- `scripts/lib/knowledge-model-eval.test.ts`

This first slice is offline and deterministic. It scores Gemma/Qwen-shaped KG
outputs through the real KG parser and relationship-promotion gate, and it
scores a small evidence-chunk retrieval result for recall, decoy exclusion, and
unsafe field leakage. Live Ollama Gemma/Qwen runners should feed this same
scoring contract in the next slice.

## Objective

Build a local, repeatable evaluation loop that treats Gemma and Qwen as peers
for KG extraction, keeps 512-dimensional evidence vectors as the active
retrieval lane, and measures whether reranking improves `/knowledge` answer
quality before we ship broader behavior changes.

This phase should not start with a graph-wide embedding dimension migration.
The evidence-vector lane gives us the right place to compare chunking,
fingerprints, reranking, and model output quality without disrupting confirmed
graph facts.

## Decisions

- Keep Nomic 512-dimensional embeddings as the active vector baseline until a
  bakeoff proves another 512-compatible fingerprint wins.
- Compare Gemma 4 12B and Qwen with equal importance for extraction quality.
- Evaluate chat/extraction models separately from embedding models.
- Use relationship candidates as the safety boundary for uncertain edges.
- Promote relationships only when direct quote-backed evidence passes the
  promotion gate.
- Keep reranking optional and reversible behind a feature flag.

## Workstream 1: Eval Dataset

Create a fixed corpus that exercises entity extraction, evidence retrieval, and
relationship safety.

Dataset slices:

- synthetic clean cases with expected entities, relationships, and quotes
- synthetic hard cases with negation, stale relationships, ambiguity, and
  unattributed mentions
- small anonymized demo conversations with masked evidence windows
- cross-workspace decoys for isolation checks
- no-answer queries where the correct result is low confidence or empty

Expected artifacts:

- `docs/KNOWLEDGE_GRAPH_EVALS.md` expanded with the fixture taxonomy
- JSON fixtures under the existing test/eval structure
- a scored report format that can compare runs over time

Required tests:

- fixture schema validation
- deterministic no-network eval loading
- cross-workspace decoy exclusion
- no-answer behavior

## Workstream 2: Gemma Versus Qwen Extraction Bakeoff

Run both extraction models through the same prompt, parser, and promotion
pipeline.

Metrics:

- entity precision and recall
- alias quality
- relationship precision and recall
- quote-backed relationship rate
- quote verification rate
- negation and stale-relation rejection
- JSON parse validity
- latency and token/runtime cost
- false merge rate

Implementation steps:

1. Add a model-runner abstraction for KG extraction evals.
2. Run Gemma 4 12B and Qwen on the same fixture set.
3. Store raw model JSON, normalized output, parser warnings, and scoring.
4. Report per-slice results, not just an aggregate score.
5. Make the app model selection a config decision only after the bakeoff.

Required tests:

- model output parser accepts both Gemma and Qwen variants
- malformed JSON recovery remains bounded
- quote-backed eligible relationships are promoted to `eligible`
- heuristic, negated, stale, or unquoted relationships stay review-only
- benchmark report fails the run when safety regressions exceed thresholds

## Workstream 3: Evidence Retrieval Quality

Measure whether evidence chunks improve recall and explanation quality versus
node-only search.

Metrics:

- evidence recall@5 and recall@10
- top evidence chunk exact-match rate
- node-only versus evidence-lane comparison
- fingerprint-filtered search parity
- no-result precision
- query latency p50 and p95

Implementation steps:

1. Add eval queries with expected evidence IDs or quote spans.
2. Compare node-only, evidence-only, and merged retrieval.
3. Record matched chunk IDs, similarity, fingerprint, and rank.
4. Keep 512-dimensional vectors as the baseline.
5. Add optional embedding-model bakeoff only after the retrieval report is
   stable.

Required tests:

- query embedding dimension smoke
- active fingerprint filtering
- incompatible fingerprint isolation
- evidence chunk projection excludes embeddings
- cross-workspace retrieval isolation
- exact SQL smoke against pgvector for HNSW and halfvec behavior

## Workstream 4: Reranking

Add a local reranking stage after dense evidence retrieval.

Initial behavior:

- retrieve top 30 to 100 evidence chunks
- rerank only evidence chunks, not confirmed graph truth
- apply only to `/knowledge` search and relationship review at first
- keep dense-only results as the rollback path

Candidate rerankers:

- local Qwen reranker if available in the target runtime
- local LLM pairwise/listwise scorer if reranker packaging is not ready
- deterministic lexical fallback for tests

Metrics:

- dense-only versus dense-plus-rerank evidence recall@k
- NDCG or MRR over fixture queries
- quote-match accuracy
- contradiction handling
- p50 and p95 rerank latency
- local CPU/RAM pressure

Required tests:

- reranker disabled fallback
- deterministic fallback ordering
- timeout fallback to dense ranking
- no raw embeddings or unsafe source text returned
- ranking improves or preserves fixture score before enabling by default

## Workstream 5: Rollout

Feature flags:

- `knowledge_evidence_chunks`: already implemented as the retrieval lane
- `knowledge_model_bakeoff`: eval-only, no user-facing behavior change
- `knowledge_evidence_rerank`: disabled by default
- `knowledge_extraction_model_gemma`: config-controlled candidate
- `knowledge_extraction_model_qwen`: config-controlled candidate

Rollout sequence:

1. Land Phase 1 evidence chunks.
2. Add eval fixtures and report generation.
3. Run Gemma/Qwen extraction bakeoff locally.
4. Run evidence retrieval report on fixed fixtures.
5. Add reranker behind a flag.
6. Compare dense-only versus reranked reports.
7. Switch extraction model or reranker only when the eval report justifies it.

Rollback:

- disable reranking flag
- revert extraction model config
- keep evidence chunks stored for inspection
- keep node-only search path available
- do not delete old fingerprint lanes until a new lane has passed evals

## Acceptance Criteria

- Eval report runs locally without external services beyond Ollama/Postgres.
- Gemma and Qwen are scored on the same fixtures.
- Relationship promotion remains quote-gated.
- Evidence retrieval reports include recall, precision, no-answer, and latency.
- Reranking can be enabled and disabled without schema changes.
- 512-dimensional vector compatibility remains enforced by fingerprint checks.
