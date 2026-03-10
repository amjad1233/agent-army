-- 001-autopilot.sql
-- Add autopilot columns to projects table
ALTER TABLE projects ADD COLUMN autopilot_enabled INTEGER DEFAULT 0;
ALTER TABLE projects ADD COLUMN autopilot_max_agents INTEGER DEFAULT 3;
ALTER TABLE projects ADD COLUMN autopilot_excluded_labels TEXT DEFAULT '["still thinking","wip","blocked"]';
