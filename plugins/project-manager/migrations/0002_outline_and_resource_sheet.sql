ALTER TABLE plugin_pm_df227baad7.task_schedule ADD COLUMN IF NOT EXISTS parent_issue_id text;
ALTER TABLE plugin_pm_df227baad7.task_schedule ADD COLUMN IF NOT EXISTS collapsed boolean NOT NULL DEFAULT false;
ALTER TABLE plugin_pm_df227baad7.resources ADD COLUMN IF NOT EXISTS initials text;
ALTER TABLE plugin_pm_df227baad7.resources ADD COLUMN IF NOT EXISTS group_name text;
ALTER TABLE plugin_pm_df227baad7.resources ADD COLUMN IF NOT EXISTS max_units_pct integer NOT NULL DEFAULT 100;
ALTER TABLE plugin_pm_df227baad7.resources ADD COLUMN IF NOT EXISTS overtime_rate numeric;
