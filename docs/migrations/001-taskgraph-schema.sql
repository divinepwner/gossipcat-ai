-- TaskGraph Supabase Schema
-- Run via Supabase dashboard SQL editor
-- See: docs/superpowers/specs/2026-03-21-taskgraph-supabase-design.md

CREATE TABLE IF NOT EXISTS tasks (
  id text PRIMARY KEY,
  agent_id text NOT NULL,
  task text NOT NULL,
  skills text[],
  parent_id text REFERENCES tasks(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('created', 'completed', 'failed', 'cancelled')),
  result text,
  error text,
  duration_ms integer,
  user_id text NOT NULL,
  project_id text NOT NULL,
  created_at timestamptz NOT NULL,
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_tasks_agent ON tasks(agent_id);
CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_id);
CREATE INDEX IF NOT EXISTS idx_tasks_user ON tasks(user_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_created ON tasks(created_at DESC);

CREATE TABLE IF NOT EXISTS task_decompositions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id text NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  strategy text NOT NULL CHECK (strategy IN ('single', 'parallel', 'sequential')),
  sub_task_ids text[] NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_decomp_parent ON task_decompositions(parent_id);

CREATE TABLE IF NOT EXISTS task_references (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_task_id text NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  to_task_id text NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  relationship text NOT NULL CHECK (relationship IN ('triggered_by', 'fixes', 'follows_up', 'related_to')),
  evidence text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_refs_from ON task_references(from_task_id);
CREATE INDEX IF NOT EXISTS idx_refs_to ON task_references(to_task_id);

CREATE TABLE IF NOT EXISTS agent_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  agent_id text NOT NULL,
  task_id text REFERENCES tasks(id) ON DELETE CASCADE,
  task_type text,
  skills text[],
  lens text,
  relevance smallint CHECK (relevance BETWEEN 1 AND 5),
  accuracy smallint CHECK (accuracy BETWEEN 1 AND 5),
  uniqueness smallint CHECK (uniqueness BETWEEN 1 AND 5),
  source text CHECK (source IN ('judgment', 'outcome')),
  event text,
  evidence text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_scores_agent ON agent_scores(agent_id);
CREATE INDEX IF NOT EXISTS idx_scores_task ON agent_scores(task_id);
CREATE INDEX IF NOT EXISTS idx_scores_user ON agent_scores(user_id);

-- RLS policies — single-tenant assumption.
-- For multi-tenant, replace with user_id-based filtering + Supabase Auth JWT claims.
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_decompositions ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_references ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_scores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access (single-tenant)" ON tasks FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access (single-tenant)" ON task_decompositions FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access (single-tenant)" ON task_references FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access (single-tenant)" ON agent_scores FOR ALL USING (true) WITH CHECK (true);
