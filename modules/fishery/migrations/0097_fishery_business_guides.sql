CREATE TABLE fishery_business_guides (
  id text PRIMARY KEY,
  document_id text NOT NULL REFERENCES fishery_documents(id),
  revision integer NOT NULL CHECK (revision > 0),
  status text NOT NULL CHECK (status IN ('draft','approved','rejected','withdrawn')),
  snapshot jsonb NOT NULL,
  snapshot_hash text NOT NULL,
  payload jsonb NOT NULL,
  payload_hash text NOT NULL,
  human_decision jsonb,
  verified_at timestamptz,
  actor text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
