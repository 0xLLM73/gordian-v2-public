# Data Classification

This repository is intended for local-first experimentation. The safest default
is no Telegram personal-account access and no external AI processing.

## Encrypted Fields

Message text, contact names, contact phone/email fields, commitments, deals,
drafts, briefs, digests, knowledge evidence snippets, knowledge node names and
descriptions, calendar tokens/content, and Telegram account session ciphertext
are encrypted at rest through the workspace envelope or session-key path.

## Plaintext Metadata

IDs, timestamps, workspace membership rows, status fields, enum values, counts,
and many JSON metadata fields are plaintext. Treat audit metadata as structural
only; it must not store contact names, phone numbers, Telegram user IDs, message
text, search queries, or raw prompts.

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
