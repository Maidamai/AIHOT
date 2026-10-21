CREATE TABLE fishery_business_ai_reviews (
  id text PRIMARY KEY,
  guide_id text NOT NULL REFERENCES fishery_business_guides(id),
  document_id text NOT NULL REFERENCES fishery_documents(id),
  identity text NOT NULL,
  binding jsonb NOT NULL,
  binding_hash text NOT NULL,
  status text NOT NULL CHECK (status IN ('queued','running','failed','needs_evidence','needs_final_human')),
  request_intent jsonb NOT NULL,
  result jsonb,
  receipt_id bigint REFERENCES receipts(id),
  error jsonb,
  actor text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(guide_id,identity),
  UNIQUE(guide_id,binding_hash)
);
