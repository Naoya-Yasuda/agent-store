-- Governance and Audit Features Migration
-- Created: 2025-11-15

-- Trust Signals テーブル（運用中のインシデント報告）
CREATE TABLE IF NOT EXISTS trust_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL,
  signal_type TEXT NOT NULL CHECK (signal_type IN ('security_incident', 'functional_error', 'performance_degradation', 'user_complaint', 'compliance_violation')),
  severity TEXT NOT NULL CHECK (severity IN ('critical', 'high', 'medium', 'low', 'info')),
  description TEXT,
  metadata JSONB DEFAULT '{}',
  reporter_id UUID,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  resolved_at TIMESTAMP WITH TIME ZONE,
  resolution_notes TEXT
);

CREATE INDEX idx_trust_signals_agent_id ON trust_signals(agent_id);
CREATE INDEX idx_trust_signals_created_at ON trust_signals(created_at DESC);
CREATE INDEX idx_trust_signals_severity ON trust_signals(severity);

-- Governance Policies テーブル（ポリシーバージョン管理）
CREATE TABLE IF NOT EXISTS governance_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_type TEXT NOT NULL CHECK (policy_type IN ('aisi_prompt', 'security_threshold', 'functional_threshold', 'blacklist', 'terms_of_service')),
  version TEXT NOT NULL,
  content JSONB NOT NULL,
  is_active BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  activated_at TIMESTAMP WITH TIME ZONE,
  UNIQUE (policy_type, version)
);

CREATE INDEX idx_governance_policies_type_active ON governance_policies(policy_type, is_active);
CREATE INDEX idx_governance_policies_created_at ON governance_policies(created_at DESC);

-- Policy Audit Log テーブル（ポリシー変更履歴）
CREATE TABLE IF NOT EXISTS policy_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id UUID NOT NULL REFERENCES governance_policies(id),
  action TEXT NOT NULL CHECK (action IN ('created', 'activated', 'deactivated', 'deleted')),
  performed_by UUID,
  performed_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  notes TEXT
);

CREATE INDEX idx_policy_audit_log_policy_id ON policy_audit_log(policy_id);
CREATE INDEX idx_policy_audit_log_performed_at ON policy_audit_log(performed_at DESC);

-- Trust Score History テーブルが存在しない場合は作成（既存の場合はスキップ）
CREATE TABLE IF NOT EXISTS trust_score_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id UUID NOT NULL REFERENCES submissions(id),
  total_score INTEGER NOT NULL CHECK (total_score >= 0 AND total_score <= 100),
  security_score INTEGER CHECK (security_score >= 0 AND security_score <= 30),
  functional_score INTEGER CHECK (functional_score >= 0 AND functional_score <= 40),
  judge_score INTEGER CHECK (judge_score >= 0 AND judge_score <= 20),
  implementation_score INTEGER CHECK (implementation_score >= 0 AND implementation_score <= 10),
  auto_decision TEXT CHECK (auto_decision IN ('auto_approved', 'auto_rejected', 'requires_human_review')),
  reasoning JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_trust_score_history_submission ON trust_score_history(submission_id);
CREATE INDEX IF NOT EXISTS idx_trust_score_history_created_at ON trust_score_history(created_at DESC);

-- Fairness Metrics テーブル（Phase 4: バイアス検出とキャリブレーション）
CREATE TABLE IF NOT EXISTS fairness_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id UUID NOT NULL REFERENCES submissions(id),
  metric_type TEXT NOT NULL CHECK (metric_type IN ('position_bias', 'judge_agreement', 'calibration_error', 'demographic_parity')),
  metric_value NUMERIC NOT NULL,
  metadata JSONB DEFAULT '{}',
  measured_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE INDEX idx_fairness_metrics_submission ON fairness_metrics(submission_id);
CREATE INDEX idx_fairness_metrics_type ON fairness_metrics(metric_type);
CREATE INDEX idx_fairness_metrics_measured_at ON fairness_metrics(measured_at DESC);

-- Ledger Export Log テーブル（監査レジャーのエクスポート履歴）
CREATE TABLE IF NOT EXISTS ledger_export_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id UUID NOT NULL REFERENCES submissions(id),
  workflow_id TEXT NOT NULL,
  run_id TEXT,
  digest_sha256 TEXT NOT NULL,
  export_path TEXT NOT NULL,
  http_posted BOOLEAN DEFAULT false,
  http_attempts INTEGER DEFAULT 0,
  http_error TEXT,
  exported_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE INDEX idx_ledger_export_submission ON ledger_export_log(submission_id);
CREATE INDEX idx_ledger_export_exported_at ON ledger_export_log(exported_at DESC);
CREATE INDEX idx_ledger_export_http_posted ON ledger_export_log(http_posted);

-- Agent Performance Metrics テーブル（運用メトリクス）
CREATE TABLE IF NOT EXISTS agent_performance_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL,
  metric_date DATE NOT NULL,
  total_calls INTEGER DEFAULT 0,
  successful_calls INTEGER DEFAULT 0,
  failed_calls INTEGER DEFAULT 0,
  avg_response_time_ms INTEGER,
  p95_response_time_ms INTEGER,
  p99_response_time_ms INTEGER,
  error_rate NUMERIC,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE (agent_id, metric_date)
);

CREATE INDEX idx_agent_performance_agent_id ON agent_performance_metrics(agent_id);
CREATE INDEX idx_agent_performance_date ON agent_performance_metrics(metric_date DESC);

COMMENT ON TABLE trust_signals IS 'Runtime trust signals and incident reports for published agents';
COMMENT ON TABLE governance_policies IS 'Version-controlled governance policies (AISI prompts, thresholds, blacklists)';
COMMENT ON TABLE policy_audit_log IS 'Audit trail for policy changes with 4-eyes approval tracking';
COMMENT ON TABLE trust_score_history IS 'Historical trust score calculations for transparency and audit';
COMMENT ON TABLE fairness_metrics IS 'Fairness and bias metrics for judge panel calibration';
COMMENT ON TABLE ledger_export_log IS 'Temporal workflow ledger export history for compliance';
COMMENT ON TABLE agent_performance_metrics IS 'Daily aggregated performance metrics for published agents';
