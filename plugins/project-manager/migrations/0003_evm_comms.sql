ALTER TABLE plugin_pm_df227baad7.project_plans ADD COLUMN IF NOT EXISTS budget_amount numeric;
ALTER TABLE plugin_pm_df227baad7.project_plans ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'USD';
ALTER TABLE plugin_pm_df227baad7.project_plans ADD COLUMN IF NOT EXISTS sponsor text;
ALTER TABLE plugin_pm_df227baad7.project_plans ADD COLUMN IF NOT EXISTS pm_name text;
ALTER TABLE plugin_pm_df227baad7.project_plans ADD COLUMN IF NOT EXISTS pm_email text;
ALTER TABLE plugin_pm_df227baad7.project_plans ADD COLUMN IF NOT EXISTS rag_override text;
ALTER TABLE plugin_pm_df227baad7.project_plans ADD COLUMN IF NOT EXISTS auto_nudge boolean NOT NULL DEFAULT false;
ALTER TABLE plugin_pm_df227baad7.project_plans ADD COLUMN IF NOT EXISTS report_recipients text;
ALTER TABLE plugin_pm_df227baad7.task_schedule ADD COLUMN IF NOT EXISTS planned_cost numeric;
ALTER TABLE plugin_pm_df227baad7.task_schedule ADD COLUMN IF NOT EXISTS actual_cost_manual numeric;
ALTER TABLE plugin_pm_df227baad7.task_schedule ADD COLUMN IF NOT EXISTS actual_hours numeric;
CREATE TABLE IF NOT EXISTS plugin_pm_df227baad7.ev_snapshots (
  id text PRIMARY KEY,
  company_id text NOT NULL,
  project_id text NOT NULL,
  snapshot_date date NOT NULL,
  pv numeric NOT NULL DEFAULT 0,
  ev numeric NOT NULL DEFAULT 0,
  ac numeric NOT NULL DEFAULT 0,
  bac numeric NOT NULL DEFAULT 0,
  pct_complete numeric NOT NULL DEFAULT 0,
  spi numeric,
  cpi numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, snapshot_date)
);
CREATE TABLE IF NOT EXISTS plugin_pm_df227baad7.stakeholders (
  id text PRIMARY KEY,
  company_id text NOT NULL,
  project_id text NOT NULL,
  name text NOT NULL,
  role text,
  organization text,
  email text,
  user_id text,
  agent_id text,
  power text NOT NULL DEFAULT 'medium',
  interest text NOT NULL DEFAULT 'medium',
  channel text,
  frequency text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS plugin_pm_df227baad7.comm_plan (
  id text PRIMARY KEY,
  company_id text NOT NULL,
  project_id text NOT NULL,
  item text NOT NULL,
  audience text,
  channel text,
  frequency text,
  owner text,
  next_due date,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS plugin_pm_df227baad7.raid_items (
  id text PRIMARY KEY,
  company_id text NOT NULL,
  project_id text NOT NULL,
  kind text NOT NULL,
  title text NOT NULL,
  description text,
  probability integer,
  impact integer,
  response text,
  owner text,
  status text NOT NULL DEFAULT 'open',
  due_date date,
  issue_id text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz
);
CREATE TABLE IF NOT EXISTS plugin_pm_df227baad7.status_reports (
  id text PRIMARY KEY,
  company_id text NOT NULL,
  project_id text NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  rag text NOT NULL,
  content_md text NOT NULL,
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  sent_to jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS plugin_pm_df227baad7.nudges (
  id text PRIMARY KEY,
  company_id text NOT NULL,
  project_id text NOT NULL,
  issue_id text,
  target_kind text NOT NULL,
  target_id text,
  target_name text,
  channel text NOT NULL,
  message text,
  actor text,
  created_at timestamptz NOT NULL DEFAULT now()
);
