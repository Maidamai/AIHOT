CREATE TABLE fishery_publication_bindings (
  kind text NOT NULL CHECK (kind IN ('article','business_guide')),
  item_id text NOT NULL,
  article_id text NOT NULL UNIQUE REFERENCES articles(id),
  document_id text NOT NULL REFERENCES fishery_documents(id),
  projection_hash text NOT NULL,
  material_revision integer NOT NULL,
  title text NOT NULL,
  summary text NOT NULL,
  category text NOT NULL,
  url text NOT NULL,
  actor text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (kind,item_id)
);
