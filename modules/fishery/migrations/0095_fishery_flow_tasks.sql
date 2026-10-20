CREATE TABLE fishery_flow_tasks (
  id text PRIMARY KEY,
  document_id text NOT NULL REFERENCES fishery_documents(id),
  identity text NOT NULL,
  snapshot jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('queued','running','failed','needs_evidence','needs_human_review','qualified','rejected')),
  stage text NOT NULL CHECK (stage IN ('generation','review','human')),
  generation_attempt integer NOT NULL DEFAULT 1 CHECK (generation_attempt BETWEEN 1 AND 3),
  review_attempt integer NOT NULL DEFAULT 1 CHECK (review_attempt BETWEEN 1 AND 3),
  draft jsonb,
  quality_review jsonb,
  human_decision jsonb,
  error jsonb,
  actor text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(document_id,identity)
);
