-- MCP ChatGPT capture-flow idempotency policies.
-- Safe to re-run.

BEGIN;

INSERT INTO pkm.idempotency_policies (
  policy_key,
  source,
  content_type,
  conflict_action,
  update_fields,
  enabled
)
VALUES
  (
    'chatgpt_session_note_v1',
    'chatgpt',
    'note',
    'update',
    ARRAY[
      'source',
      'intent',
      'content_type',
      'title',
      'author',
      'capture_text',
      'clean_text',
      'content_hash',
      'metadata',
      'topic_primary',
      'topic_secondary',
      'topic_secondary_confidence',
      'keywords',
      'enrichment_status',
      'enrichment_model',
      'prompt_version',
      'gist',
      'retrieval_excerpt',
      'distill_summary',
      'distill_why_it_matters',
      'distill_stance',
      'distill_version',
      'distill_created_from_hash',
      'distill_status',
      'distill_metadata'
    ]::text[],
    true
  ),
  (
    'chatgpt_working_memory_v1',
    'chatgpt',
    'working_memory',
    'update',
    ARRAY[
      'source',
      'intent',
      'content_type',
      'title',
      'author',
      'capture_text',
      'clean_text',
      'content_hash',
      'metadata',
      'topic_primary',
      'topic_secondary',
      'topic_secondary_confidence',
      'keywords',
      'enrichment_status',
      'enrichment_model',
      'prompt_version',
      'gist',
      'retrieval_excerpt',
      'distill_summary',
      'distill_why_it_matters',
      'distill_stance',
      'distill_version',
      'distill_created_from_hash',
      'distill_status',
      'distill_metadata'
    ]::text[],
    true
  )
ON CONFLICT (policy_key) DO UPDATE SET
  source = EXCLUDED.source,
  content_type = EXCLUDED.content_type,
  conflict_action = EXCLUDED.conflict_action,
  update_fields = EXCLUDED.update_fields,
  enabled = EXCLUDED.enabled;

INSERT INTO pkm_test.idempotency_policies (
  policy_key,
  source,
  content_type,
  conflict_action,
  update_fields,
  enabled
)
VALUES
  (
    'chatgpt_session_note_v1',
    'chatgpt',
    'note',
    'update',
    ARRAY[
      'source',
      'intent',
      'content_type',
      'title',
      'author',
      'capture_text',
      'clean_text',
      'content_hash',
      'metadata',
      'topic_primary',
      'topic_secondary',
      'topic_secondary_confidence',
      'keywords',
      'enrichment_status',
      'enrichment_model',
      'prompt_version',
      'gist',
      'retrieval_excerpt',
      'distill_summary',
      'distill_why_it_matters',
      'distill_stance',
      'distill_version',
      'distill_created_from_hash',
      'distill_status',
      'distill_metadata'
    ]::text[],
    true
  ),
  (
    'chatgpt_working_memory_v1',
    'chatgpt',
    'working_memory',
    'update',
    ARRAY[
      'source',
      'intent',
      'content_type',
      'title',
      'author',
      'capture_text',
      'clean_text',
      'content_hash',
      'metadata',
      'topic_primary',
      'topic_secondary',
      'topic_secondary_confidence',
      'keywords',
      'enrichment_status',
      'enrichment_model',
      'prompt_version',
      'gist',
      'retrieval_excerpt',
      'distill_summary',
      'distill_why_it_matters',
      'distill_stance',
      'distill_version',
      'distill_created_from_hash',
      'distill_status',
      'distill_metadata'
    ]::text[],
    true
  )
ON CONFLICT (policy_key) DO UPDATE SET
  source = EXCLUDED.source,
  content_type = EXCLUDED.content_type,
  conflict_action = EXCLUDED.conflict_action,
  update_fields = EXCLUDED.update_fields,
  enabled = EXCLUDED.enabled;

COMMIT;
