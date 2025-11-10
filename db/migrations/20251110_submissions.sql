-- Submission intake and endpoint snapshot tables (2025-11-10)
CREATE TABLE IF NOT EXISTS submissions (
    id UUID PRIMARY KEY,
    agent_id UUID NOT NULL,
    card_document JSONB NOT NULL,
    endpoint_manifest JSONB NOT NULL,
    endpoint_snapshot_hash TEXT NOT NULL,
    signature_bundle JSONB NOT NULL,
    organization_meta JSONB NOT NULL,
    state TEXT NOT NULL,
    manifest_warnings TEXT[] DEFAULT '{}',
    request_context JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_submissions_agent_id ON submissions(agent_id);
CREATE INDEX IF NOT EXISTS idx_submissions_state ON submissions(state);

CREATE TABLE IF NOT EXISTS agent_endpoint_snapshots (
    id UUID PRIMARY KEY,
    agent_id UUID NOT NULL,
    relay_id TEXT UNIQUE,
    manifest JSONB NOT NULL,
    snapshot_hash TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_endpoint_snapshots_agent_id ON agent_endpoint_snapshots(agent_id);
