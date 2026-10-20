CREATE TABLE fishery_documents (
  id text PRIMARY KEY,
  source_id text NOT NULL REFERENCES fishery_sources (source_id),
  article_id text,
  issuer text NOT NULL,
  document_number text,
  canonical_url text NOT NULL,
  withdrawn_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_id, canonical_url)
);
