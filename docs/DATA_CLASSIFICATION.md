# Data Classification

This repository is intended for local-first experimentation. The safest default
is no Telegram personal-account access and no external AI processing.

## Encrypted Fields

Message text, contact names, contact phone/email fields, commitments, deals,
deal artifact titles and URL/file references, saved deal AI output,
uncertainty text, deal AI source manifests, drafts, briefs, digests, knowledge
evidence snippets, knowledge node names and descriptions, calendar
tokens/content, and Telegram account session ciphertext are encrypted at rest
through the workspace envelope or session-key path.

## Plaintext Metadata

IDs, timestamps, workspace membership rows, status fields, enum values, counts,
deal artifact type, deal AI model role/name/local-vendor mode, source counts,
and many JSON metadata fields are plaintext. Treat audit metadata as structural
only; it must not store contact names, phone numbers, Telegram user IDs, message
text, search queries, raw prompts, deal artifact titles, deal artifact URLs,
deal AI source labels/snippets, or raw local model output.

## Embeddings

Embeddings are sensitive because approximate source text can sometimes be
reconstructed. Cloud worker embedding calls are blocked unless
`AI_PROCESSING_ENABLED=true`; local OpenAI-compatible embedding endpoints can run
without that vendor-egress gate. General CRM search embeddings are additionally
blocked unless `AI_SEARCH_EMBEDDINGS_ENABLED=true`, and the query is ELM-masked
before it is sent for embedding.

## Redis And BullMQ

Redis/Dragonfly holds transient rate-limit keys, Telegram auth hashes, send
cooldowns, idempotency markers, and BullMQ job payloads. Job payloads may contain
encrypted message content or masked AI context. Local teardown should purge
runtime keys and queues before sharing or archiving a runtime snapshot.

## Logs And Audit Rows

Logs and audit rows should contain structural information only: action type,
resource type, opaque IDs, counts, and booleans. They should not contain contact
names, phone numbers, Telegram IDs, raw message text, raw user search queries,
or full prompt content.

## Sensitive Category Behavior Matrix

| Category | Storage location | Allowed UI surfaces | Allowed export behavior | Logging behavior | Purge behavior |
| --- | --- | --- | --- | --- | --- |
| Contact identity fields | `contacts` encrypted name, username, phone, email, and notes fields; plaintext opaque row IDs and account scoping IDs | Contact list/detail, search, deal/contact relationship surfaces, and explicit owner-driven edit flows | Basic CRM export may include names, username, phone, and email for authenticated workspace users; it must omit contact notes, Telegram IDs, account scoping IDs, blind indexes, workspace IDs, and inaccessible contacts | Do not log names, usernames, phones, emails, notes, blind indexes, Telegram IDs, or source account IDs | Deleted by account/workspace purge and workspace envelope loss; local demo/runtime snapshots must be purged before sharing |
| Telegram identifiers and thread IDs | `contacts.telegram_id`, `contacts.source_account_id`, `chats.telegram_chat_id`, `chats.source_account_id`, message Telegram IDs and sender IDs | Stable labels such as `Telegram account 1`; route filters may use local account indexes, not raw account IDs | Never included in basic CRM export; account filters and onboarding/import payloads use stable keys or internal request bodies only | Do not log raw Telegram user IDs, chat IDs, sender IDs, account IDs, or phone-code hashes | Deleted by Telegram disconnect, account/workspace purge, and runtime purge of Telegram queues/session locks |
| Message bodies | `messages.text`, commitment quotes/source context, memory content, follow-up draft text, and related encrypted text fields | User-owned message review, commitments review, knowledge evidence, and follow-up drafting surfaces after authorization | Not included in basic CRM export; source message IDs, quotes, snippets, and raw body fields are excluded | Do not log raw message text, snippets, quotes, prompt context, or serialized message payloads | Deleted by account/workspace purge; runtime queue payloads must be purged before release snapshots |
| Session-related fields and provider tokens | Better Auth session tokens, account provider tokens, Telegram session ciphertext, per-user KEK blobs, calendar OAuth tokens, and keychain-backed local credentials | Settings may show connected/disabled status only; never raw token or session material | Never included in basic CRM export or public/demo fixtures | Do not log token values, session strings, phone-code hashes, Keychain secrets, or Authorization headers | Deleted by disconnect/account purge, provider-side token rotation, keychain cleanup, and local runtime purge |
| AI prompt and output fields | Follow-up prompts and drafts, deal AI outputs, uncertainty, source manifests, briefs, digests, summaries, golden examples, and correction diffs | Feature-specific review/edit surfaces after authorization and provider/local-mode gates | Not included in basic CRM export unless a future guarded AI archive explicitly documents the field and owner consent | Log structural AI metadata only: model mode, counts, booleans, opaque IDs, and timing; never prompts, outputs, source snippets, or raw local model text | Deleted by account/workspace purge; provider observability must be disabled or explicitly accepted before release |
| Saved deal AI output | `deal_ai_runs.output`, `deal_ai_runs.uncertainty`, and `deal_ai_runs.source_manifest` | Deal cockpit/review surfaces for authorized users | Excluded from basic CRM export together with deal artifacts and other sensitive deal extensions | Log run status, model role/name, local-vendor mode, and counts only | Deleted by deal/workspace purge and excluded from public fixtures |
| Embedding and derived vector fields | `memories.embedding`, `knowledge_nodes.embedding`, correction diff embeddings, sanitized memory text, and embedding fingerprints | Search/knowledge surfaces may show derived labels/evidence after authorization; raw vectors are never shown | Never included in basic CRM export | Do not log vectors, raw embedding inputs, unmasked search queries, or high-dimensional arrays | Deleted by workspace purge; local vector indexes and caches must be regenerated from sanitized/encrypted source data |
| Knowledge graph derived fields | Encrypted knowledge node names/display names/descriptions, evidence rows, contact links, and metadata | Knowledge graph/search/detail surfaces after authorization | Not included in basic CRM export; derived evidence snippets require a separately guarded archive path | Log counts, node IDs, relation types, and selection method only | Deleted by workspace purge and regenerated by extraction jobs |
| Calendar event details | Calendar provider tokens, encrypted calendar email, event title, description, location, attendees, external IDs, and event metadata | Calendar/import surfaces and matched contact context after authorization | Not included in basic CRM export | Log provider/status/counts only; never event titles, descriptions, attendees, locations, external IDs, or OAuth tokens | Deleted by disconnect/account/workspace purge and provider token revocation |
| Audit event metadata | `audit_logs` structural event rows and JSON metadata | Settings audit view with safe summaries and opaque resource identifiers | Excluded from basic CRM export; future audit export must use a metadata allowlist | Metadata must remain structural only: action/resource/actor type, opaque IDs, counts, booleans, and correlation IDs | Deleted by workspace purge; append-only rows must not be used to retain sensitive payloads |

## Third-Party Providers

External AI vendor egress is disabled by default through
`AI_PROCESSING_ENABLED=false`. Enabling it allows configured Anthropic, OpenAI,
or Gemini paths to receive masked or derived content depending on the feature.
Helicone is disabled separately through `HELICONE_ENABLED=false`; set it to true
only if prompt observability is acceptable for the local run.

Local commitment extraction uses `COMMITMENT_LLM_PROVIDER=local` and a local
chat endpoint. The Qwen/Ollama preset uses native Ollama `/api/chat` with
thinking disabled and JSON output enforced. Local extraction stores accepted
items as drafts by default, grounds each accepted item to source message IDs and
a quote from the masked episode, does not enable Claude fulfillment detection or
rationale extraction, and still requires local embeddings before extracted
commitments can be stored or deduplicated.
