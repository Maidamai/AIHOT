CREATE TABLE fishery_sources (
  source_id text PRIMARY KEY REFERENCES sources (id),
  revision integer NOT NULL CHECK (revision > 0),
  profile jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
