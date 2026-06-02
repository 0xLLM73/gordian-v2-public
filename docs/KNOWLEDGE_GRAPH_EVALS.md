# Knowledge Graph Recall Evals

This repo has a deterministic eval fixture and a lightweight quality gate for
message-backed `/knowledge` recall:

```bash
pnpm kg:recall:eval
pnpm kg:recall:quality
pnpm kg:recall:pg:smoke
```

`pnpm kg:recall:eval` is the backwards-compatible entrypoint and delegates to
`pnpm kg:recall:quality`. The quality command runs
`packages/db/src/__tests__/knowledge-recall-quality.test.ts`, prints a concise
human summary, and emits one machine-readable line prefixed with
`KNOWLEDGE_RECALL_QUALITY_JSON=`.

The original behavior-level assertions still live in
`packages/db/src/__tests__/knowledge-recall-eval.test.ts`.

`pnpm kg:recall:pg:smoke` is the opt-in live Postgres smoke. It reuses the same
fixture shape, seeds a migrated throwaway database, and calls the real DAL and
SQL functions. It is intentionally separate from normal `pnpm test` because it
requires a live Postgres database with pgvector.

The same smoke is also wired into GitHub Actions at
`.github/workflows/knowledge-recall-pg-smoke.yml`. It runs on manual dispatch
and on PRs or main pushes that touch knowledge recall, DB schema/DAL, migrations,
or the smoke fixture/script.

## Fixture Design

The fixture lives at `packages/db/src/__tests__/fixtures/knowledge-recall-fixture.ts`.

It constructs:

- 1 primary workspace and 1 decoy workspace.
- 8 primary contacts plus a decoy contact.
- 20+ primary Telegram-like messages plus decoy data.
- Knowledge nodes for `topic`, `project`, `organization`, `sector`, `technology`, and `concept`.
- `knowledge_contacts` style rows connecting contacts to topics.
- `knowledge_evidence` style rows with message ids, snippets, confidence, timestamps, evidence kind, and relation labels.
- Memories with current `metadata.messageId`.
- Legacy deterministic memories with `sourceMessageId`.
- Ambiguous and non-deterministic legacy memories that must not participate in recall.
- Decoy workspace memories and evidence that must not leak.

The current schema has no first-class `community/group` node type, so the fixture uses `sector` or `topic` for community-like graph objects and keeps that as a product/schema gap.

## Recall Paths Tested

The eval calls the real `searchKnowledgeNodesWithEvidence` DAL function while mocking DB/provider boundaries. It does not use Telegram credentials, live LLM calls, live embedding APIs, a user account, or real encrypted messages.

Covered paths:

- Exact topic search, such as `AI agents`, `CRM automation`, `Solana DePIN`, and `Helium`.
- Alias search, such as `DePIN infra` resolving to `Solana DePIN`.
- Ambiguous naming, such as `Base L2` resolving to the Base node instead of generic `base case`.
- Semantic node recall using deterministic fake vector results.
- Message/memory recall through `memory hit -> metadata.messageId/sourceMessageId -> knowledge_evidence.message_id -> knowledge_node_id`.
- Evidence enrichment with snippets, timestamps, confidence, relation labels, evidence counts, and contacts.
- Ranking where exact/alias matches outrank weak semantic matches, and node plus message recall outranks node-only recall.
- No-confident-result behavior for unrelated or weak memory-only queries.
- Cross-workspace isolation for overlapping topics and evidence snippets.
- No embedding or private raw-message details in returned search payloads.

## Quality Gate Metrics

Each deterministic query records:

- query text
- expected top node
- allowed expected-node rank
- actual rank and top node
- result count
- match reasons
- message-recall reasons
- evidence count
- message hit count
- connected contact count
- evidence snippet coverage
- timestamp coverage
- confidence coverage
- cross-workspace decoy exclusion
- ambiguous legacy-memory skip status, when applicable
- latency in milliseconds

Latency is measured and printed for trend tracking. It is not currently a hard
failure threshold because the mocked test environment is not a stable benchmark.

## Pass/Fail Thresholds

The gate fails when any query violates its case definition:

- expected node is missing
- expected node rank is worse than allowed
- required match reasons are missing
- required message-recall reasons are missing
- evidence count is below the threshold
- message hit count is below the threshold
- connected contact count is below the threshold
- required evidence snippets, timestamps, or confidence values are absent
- cross-workspace decoy data appears
- ambiguous legacy memories produce candidates
- no-confident-result queries return results

The report output is also checked for sensitive internal fields. The quality
output must not contain workspace identifiers, embeddings, encryption envelope
fields, blind indexes, raw metadata, or private raw-message details from the
fixture.

## Output Shape

Human summary example:

```text
Knowledge recall quality gate: passed
Queries: 9/9 passed
Average latency: 0.56 ms
Slowest query: AI agents (1.77 ms)
Evidence coverage: 6/6 required queries, 6 total evidence rows surfaced
Message recall coverage: 4/4 required queries, 4 total message hits
Privacy/isolation checks: passed
```

Machine-readable output example:

```json
{
	"suite": "knowledge-recall",
	"status": "passed",
	"queries": [
		{
			"query": "wireless hotspot rollout",
			"expectedNode": "Helium",
			"actualRank": 1,
			"matchReasons": ["evidence_message_match", "matched in message evidence"],
			"evidenceCount": 1,
			"messageHitCount": 1,
			"latencyMs": 0.36,
			"passed": true
		}
	]
}
```

The committed stable baseline lives at
`packages/db/src/__tests__/fixtures/knowledge-recall-quality-baseline.json`.
It intentionally excludes volatile latency values while preserving ranks, match
reasons, evidence presence, message-recall coverage, and isolation checks.

## Adding A Recall Query

Add the data needed for the scenario in
`packages/db/src/__tests__/fixtures/knowledge-recall-fixture.ts`, then add a
case to `DEFAULT_RECALL_QUALITY_CASES` in
`packages/db/src/__tests__/fixtures/knowledge-recall-quality.ts`.

For each new case, set only stable thresholds:

- expected node id and display name
- maximum allowed rank
- required match reasons
- required message-recall reasons, if message recall is expected
- minimum evidence/message/contact counts
- whether snippets, timestamps, and confidence are required
- whether no confident results are expected
- forbidden text for privacy or workspace-isolation checks

Run `pnpm kg:recall:quality`. If the behavior change is intentional, update
`knowledge-recall-quality-baseline.json` with the stable report fields, not the
latency values.

## Interpreting Node Recall Vs Message Recall

Node recall means the knowledge node itself matched through exact name, alias,
or deterministic semantic-node search.

Message recall means a masked memory hit mapped through deterministic message
metadata to `knowledge_evidence.message_id`, then to a knowledge node. Message
recall should add match reasons such as `evidence_message_match`,
`memory_full_text`, or `memory_semantic`, and it should surface supporting
evidence snippets and timestamps.

The strongest product signal is a node that matches both paths: the topic name
or semantics match, and message evidence independently supports it.

## CI Recommendation

Use `pnpm kg:recall:eval` as the CI-facing command for this quality gate. It is
fast, deterministic, and does not require providers, Telegram credentials, or a
live database.

For broad CI, keep `pnpm test` as the full-suite check; it includes both the
quality gate and the lower-level recall eval tests.

## Live Postgres Smoke

The live smoke lives at `scripts/knowledge-recall-pg-smoke.ts` and is exposed as:

```bash
pnpm kg:recall:pg:smoke
```

It requires one explicit test database variable:

```bash
KG_RECALL_PG_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/gordian_recall_test
# or
TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/gordian_recall_test
```

The command deliberately refuses to fall back to `DATABASE_URL`, because it
deletes and reseeds deterministic fixture rows. It only touches the fixture
workspace IDs:

- `10000000-0000-4000-8000-000000000001`
- `10000000-0000-4000-8000-000000000002`

Setup:

```bash
createdb gordian_recall_test
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/gordian_recall_test pnpm db:migrate
KG_RECALL_PG_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/gordian_recall_test pnpm kg:recall:pg:smoke
```

The migration runner is the existing `packages/db/scripts/migrate.ts`. It creates
the required `pgcrypto`, `vector`, and `pg_trgm` extensions, applies migrations,
and records files in `__gordian_migrations`.

CI:

```text
.github/workflows/knowledge-recall-pg-smoke.yml
```

The workflow uses `pgvector/pgvector:0.8.2-pg16-trixie`, runs `pnpm db:migrate`, then runs
`pnpm kg:recall:pg:smoke` with `KG_RECALL_PG_DATABASE_URL` pointed at the
throwaway service database. It is path-scoped so ordinary unrelated PRs do not
pay for the live DB smoke, while knowledge recall and DB-path changes do.

What the smoke verifies:

- migrated schema has `vector`, `pg_trgm`, `pgcrypto`, `hybrid_search`, and the knowledge HNSW index
- `knowledge_nodes.embedding` and `memories.embedding` are `halfvec`
- deterministic encrypted fixture rows can be inserted through the normal key context
- exact recall returns `AI agents`
- alias recall returns `Solana DePIN`
- vector recall runs the real halfvec/HNSW path and respects the minimum similarity threshold
- message recall runs real memory FTS or `hybrid_search`, maps to `knowledge_evidence.message_id`, and returns `Helium`
- combined node plus message recall ranks `Base L2` above a weaker node-only match
- evidence enrichment returns contacts, snippets, timestamps, relation labels, and confidence
- ambiguous, keyword-only, contact/timestamp-only, and unmatched-message memories do not produce candidates
- primary workspace results do not include decoy workspace nodes, snippets, or memory boosts
- DAL result payloads do not expose embeddings or fixture private raw-message details
- RLS metadata exists for knowledge and recall-adjacent tables

Human output example:

```text
Knowledge recall Postgres smoke: passed
Database: configured test database
Migrations: verified
Queries: 8/8 passed
Vector recall: passed
Message recall: passed
Evidence enrichment: passed
Workspace isolation: passed
Ambiguous memory skipping: passed
Average latency: 12.4 ms
RLS metadata: 6 tables enabled
```

The command also prints one machine-readable line:

```text
KNOWLEDGE_RECALL_PG_SMOKE_JSON={"suite":"knowledge-recall-postgres-smoke","status":"passed",...}
```

What it does not verify:

- browser rendering
- chat citations
- global search
- real Telegram ingestion
- live LLM or embedding providers
- production semantic quality
- hard latency budgets

## Local Provider Smoke

Use `pnpm kg:local:smoke` to verify a local OpenAI-compatible provider before
running manual knowledge analysis in local OSS mode. The smoke is intentionally
separate from the deterministic recall evals because it depends on a running
local model server. For the recommended Nomic path, or the Qwen vector-only path,
run:

```bash
pnpm local-ai:setup:nomic
pnpm kg:local:smoke

pnpm local-ai:setup:qwen
pnpm kg:local:smoke
```

Required local-mode env:

```env
KNOWLEDGE_EMBEDDING_PROVIDER="local"
KNOWLEDGE_EMBEDDING_PRESET="nomic"
KNOWLEDGE_EMBEDDING_BASE_URL="http://localhost:11434/v1"
KNOWLEDGE_EMBEDDING_MODEL="nomic-embed-text"
KNOWLEDGE_EMBEDDING_FINGERPRINT="local:local:nomic:nomic-embed-text:512:kg-embedding-format-v1"
KNOWLEDGE_LLM_PROVIDER="local"
KNOWLEDGE_LLM_BASE_URL="http://localhost:11434/v1"
KNOWLEDGE_LLM_MODEL="llama3.1:8b"
```

The smoke checks `/v1/models`, verifies `/v1/embeddings` returns exactly 512
dimensions, and verifies `/v1/chat/completions` returns JSON with an `entities`
array when `KNOWLEDGE_LLM_PROVIDER=local`. If KG LLM extraction is disabled, the
smoke skips the chat check and validates the vector path only. It does not use
Telegram credentials or write to the database.

RLS limitation:

The smoke verifies RLS is enabled and policies exist. In many local migrated
databases the migration owner role can bypass RLS, so the smoke also relies on
decoy workspace data to catch missing DAL workspace predicates and broken joins.

## Intentional Skips

The fixture includes memories that should not become recall candidates:

- Multiple source message ids in one legacy memory.
- Contact and timestamp metadata without a message id.
- Keyword-only metadata.
- A source message id that does not exist in the same workspace.
- Decoy workspace memories and evidence.

These are skipped because contact/time matching and fuzzy message matching are too ambiguous for a provenance backfill or a recall eval.

## Current Limitations

- The eval uses mocked SQL responses, not a real Postgres database with HNSW/FTS execution.
- It proves ranking/enrichment logic in the DAL, not browser rendering.
- It does not create new `knowledge_evidence` rows.
- It does not test chat citations or global search.
- Latency is recorded but not enforced as a hard budget.
- Community/group is represented by existing node types because the schema does not currently have that enum value.

## Next Recommended PR

Add a live Postgres integration smoke for the same fixture shape. Seed a temporary workspace, run migrations, insert the rows, and verify the SQL-native memory recall path, HNSW similarity thresholding, FTS behavior, and workspace isolation against actual database indexes.
