ALTER TABLE fishery_flow_tasks ADD CONSTRAINT fishery_flow_tasks_stage_check CHECK (stage IN ('prefilter','score-1','score-2','generation','structure','review','human')) NOT VALID;
