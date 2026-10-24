CREATE TABLE fishery_document_purposes (
  document_id text PRIMARY KEY REFERENCES fishery_documents(id),
  purpose text NOT NULL CHECK (purpose IN ('native','manual','review_only')),
  source_revision integer,
  source_policy jsonb,
  observation_revision integer,
  body_sha256 text,
  reason text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (purpose <> 'native' OR source_revision IS NOT NULL AND source_policy IS NOT NULL AND observation_revision IS NOT NULL AND body_sha256 IS NOT NULL)
);
