CREATE TABLE fishery_observations (
  document_id text NOT NULL REFERENCES fishery_documents (id),
  revision integer NOT NULL CHECK (revision > 0),
  observed_at timestamptz NOT NULL DEFAULT now(),
  actor text NOT NULL,
  content_hash text NOT NULL,
  payload jsonb NOT NULL,
  PRIMARY KEY (document_id, revision)
);
