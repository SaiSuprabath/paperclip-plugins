CREATE TABLE IF NOT EXISTS plugin_pm_df227baad7.calendars (
  company_id text PRIMARY KEY,
  working_days jsonb NOT NULL DEFAULT '[1,2,3,4,5]'::jsonb,
  holidays jsonb NOT NULL DEFAULT '[]'::jsonb,
  hours_per_day numeric NOT NULL DEFAULT 8,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS plugin_pm_df227baad7.project_plans (
  project_id text PRIMARY KEY,
  company_id text NOT NULL,
  start_date date NOT NULL,
  status_date date,
  baseline_saved_at timestamptz,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS plugin_pm_df227baad7.task_schedule (
  issue_id text PRIMARY KEY,
  company_id text NOT NULL,
  project_id text NOT NULL,
  duration_days numeric NOT NULL DEFAULT 1,
  effort_hours numeric,
  start_date date,
  constraint_type text NOT NULL DEFAULT 'asap',
  percent_complete integer NOT NULL DEFAULT 0,
  is_milestone boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  leveling_delay_days integer NOT NULL DEFAULT 0,
  notes text,
  baseline_start date,
  baseline_finish date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS plugin_pm_df227baad7.task_links (
  id text PRIMARY KEY,
  company_id text NOT NULL,
  project_id text NOT NULL,
  predecessor_issue_id text NOT NULL,
  successor_issue_id text NOT NULL,
  link_type text NOT NULL DEFAULT 'FS',
  lag_days integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (predecessor_issue_id, successor_issue_id)
);

CREATE TABLE IF NOT EXISTS plugin_pm_df227baad7.resources (
  id text PRIMARY KEY,
  company_id text NOT NULL,
  kind text NOT NULL,
  name text NOT NULL,
  email text,
  agent_id text,
  user_id text,
  role text,
  capacity_hours_per_day numeric NOT NULL DEFAULT 8,
  cost_per_hour numeric,
  color text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS plugin_pm_df227baad7.assignments (
  id text PRIMARY KEY,
  company_id text NOT NULL,
  issue_id text NOT NULL,
  resource_id text NOT NULL,
  units_pct integer NOT NULL DEFAULT 100,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (issue_id, resource_id)
);
