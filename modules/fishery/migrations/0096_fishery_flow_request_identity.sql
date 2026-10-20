ALTER TABLE fishery_flow_tasks ADD COLUMN stage_requests jsonb NOT NULL DEFAULT '{}'::jsonb;
