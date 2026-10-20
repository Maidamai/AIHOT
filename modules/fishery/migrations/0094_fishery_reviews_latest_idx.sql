CREATE INDEX CONCURRENTLY IF NOT EXISTS fishery_reviews_latest_idx ON fishery_reviews (document_id, id DESC);
