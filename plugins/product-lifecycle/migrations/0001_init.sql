CREATE TABLE IF NOT EXISTS plugin_pl_0eca7115bb.lifecycle (
  project_id text PRIMARY KEY,
  company_id text NOT NULL,
  stage text NOT NULL DEFAULT 'discovery',
  gates jsonb NOT NULL DEFAULT '{}'::jsonb,
  vision text,
  target_launch date,
  sprint_length_days integer NOT NULL DEFAULT 14,
  default_capacity_points integer NOT NULL DEFAULT 30,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS plugin_pl_0eca7115bb.stage_history (
  id text PRIMARY KEY,
  company_id text NOT NULL,
  project_id text NOT NULL,
  from_stage text,
  to_stage text NOT NULL,
  note text,
  actor text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS plugin_pl_0eca7115bb.sprints (
  id text PRIMARY KEY,
  company_id text NOT NULL,
  project_id text NOT NULL,
  name text NOT NULL,
  goal text,
  start_date date NOT NULL,
  end_date date NOT NULL,
  status text NOT NULL DEFAULT 'planning',
  capacity_points integer NOT NULL DEFAULT 30,
  sequence integer NOT NULL DEFAULT 1,
  retro jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS plugin_pl_0eca7115bb.sprint_items (
  id text PRIMARY KEY,
  company_id text NOT NULL,
  sprint_id text NOT NULL,
  issue_id text NOT NULL,
  story_points integer,
  committed boolean NOT NULL DEFAULT true,
  carried_from_sprint_id text,
  added_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sprint_id, issue_id)
);

CREATE TABLE IF NOT EXISTS plugin_pl_0eca7115bb.issue_estimates (
  issue_id text PRIMARY KEY,
  company_id text NOT NULL,
  story_points integer,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS plugin_pl_0eca7115bb.sprint_snapshots (
  id text PRIMARY KEY,
  company_id text NOT NULL,
  sprint_id text NOT NULL,
  snapshot_date date NOT NULL,
  remaining_points integer NOT NULL,
  committed_points integer NOT NULL,
  done_points integer NOT NULL,
  UNIQUE (sprint_id, snapshot_date)
);

CREATE TABLE IF NOT EXISTS plugin_pl_0eca7115bb.change_requests (
  id text PRIMARY KEY,
  company_id text NOT NULL,
  project_id text NOT NULL,
  number integer NOT NULL,
  title text NOT NULL,
  description text,
  type text NOT NULL DEFAULT 'scope',
  impact text NOT NULL DEFAULT 'medium',
  impact_assessment text,
  status text NOT NULL DEFAULT 'draft',
  priority text NOT NULL DEFAULT 'medium',
  requested_by_type text,
  requested_by_id text,
  requested_by_name text,
  owner_agent_id text,
  owner_user_id text,
  decision_note text,
  decided_by text,
  decided_at timestamptz,
  related_issue_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  implementation_issue_id text,
  target_sprint_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS plugin_pl_0eca7115bb.change_request_events (
  id text PRIMARY KEY,
  company_id text NOT NULL,
  change_request_id text NOT NULL,
  kind text NOT NULL,
  from_status text,
  to_status text,
  note text,
  actor_type text,
  actor_id text,
  actor_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);
