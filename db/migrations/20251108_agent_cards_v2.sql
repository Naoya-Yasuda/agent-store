-- AgentCard schema extension for execution profile & attestations (2025-11-08)
ALTER TABLE agent_cards
    ADD COLUMN IF NOT EXISTS status_reason TEXT,
    ADD COLUMN IF NOT EXISTS execution_profile TEXT NOT NULL DEFAULT 'self_hosted',
    ADD COLUMN IF NOT EXISTS endpoint_relay_id TEXT,
    ADD COLUMN IF NOT EXISTS provider_registry_ids TEXT[] NOT NULL DEFAULT '{}';

CREATE TABLE IF NOT EXISTS agent_endpoint_attestations (
    id UUID PRIMARY KEY,
    card_id UUID NOT NULL REFERENCES agent_cards(id) ON DELETE CASCADE,
    endpoint_relay_id TEXT NOT NULL,
    challenge_nonce TEXT NOT NULL,
    response_signature TEXT,
    execution_fingerprint JSONB,
    round_trip_ms INTEGER,
    verified_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_endpoint_attestations_card_id ON agent_endpoint_attestations(card_id);
CREATE INDEX IF NOT EXISTS idx_agent_endpoint_attestations_endpoint_relay_id ON agent_endpoint_attestations(endpoint_relay_id);
