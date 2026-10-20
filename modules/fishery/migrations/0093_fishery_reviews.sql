CREATE TABLE fishery_reviews (
  id bigserial PRIMARY KEY,
  document_id text NOT NULL,
  revision integer NOT NULL,
  source_revision integer NOT NULL,
  decision text NOT NULL CHECK (decision IN ('approved', 'rejected')),
  applicability_reviewed boolean NOT NULL,
  note text NOT NULL,
  actor text NOT NULL,
  reviewed_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (document_id, revision) REFERENCES fishery_observations (document_id, revision)
);
