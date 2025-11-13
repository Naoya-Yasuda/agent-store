-- Trust score system for Agent Hub (2025-11-14)
-- Adds trust score columns to submissions table for the new scoring-based review system

ALTER TABLE submissions
  ADD COLUMN IF NOT EXISTS trust_score INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS security_score INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS functional_score INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS judge_score INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS implementation_score INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS score_breakdown JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS auto_decision TEXT CHECK (auto_decision IN ('auto_approved', 'auto_rejected', 'requires_human_review', NULL));

-- Create index for querying by trust score
CREATE INDEX IF NOT EXISTS idx_submissions_trust_score ON submissions(trust_score);
CREATE INDEX IF NOT EXISTS idx_submissions_auto_decision ON submissions(auto_decision);

-- Create trust score history table for tracking score changes over time
CREATE TABLE IF NOT EXISTS trust_score_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    submission_id UUID NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
    agent_id UUID NOT NULL,
    previous_score INTEGER,
    new_score INTEGER NOT NULL,
    score_change INTEGER NOT NULL,
    change_reason TEXT NOT NULL,
    stage TEXT,
    triggered_by TEXT CHECK (triggered_by IN ('system', 'human', 'incident', 're_evaluation')),
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_trust_score_history_submission ON trust_score_history(submission_id);
CREATE INDEX IF NOT EXISTS idx_trust_score_history_agent ON trust_score_history(agent_id);
CREATE INDEX IF NOT EXISTS idx_trust_score_history_created ON trust_score_history(created_at DESC);

COMMENT ON COLUMN submissions.trust_score IS 'Overall trust score (0-100): aggregated from all stage scores';
COMMENT ON COLUMN submissions.security_score IS 'Security Gate score (0-30): prompt injection resistance';
COMMENT ON COLUMN submissions.functional_score IS 'Functional Accuracy score (0-40): use case alignment';
COMMENT ON COLUMN submissions.judge_score IS 'Judge Panel score (0-20): LLM quality evaluation';
COMMENT ON COLUMN submissions.implementation_score IS 'Implementation Quality score (0-10): response time, error handling';
COMMENT ON COLUMN submissions.score_breakdown IS 'Detailed score breakdown with reasoning for each stage';
COMMENT ON COLUMN submissions.auto_decision IS 'Automated decision based on score: auto_approved (≥80), auto_rejected (<40), requires_human_review (40-79)';

COMMENT ON TABLE trust_score_history IS 'Historical record of trust score changes for audit and transparency';
COMMENT ON COLUMN trust_score_history.change_reason IS 'Human-readable reason for score change (e.g., "Security incident reported", "Re-evaluation passed")';
COMMENT ON COLUMN trust_score_history.triggered_by IS 'What triggered the score change: system (automatic), human (manual review), incident (problem report), re_evaluation (scheduled recheck)';
