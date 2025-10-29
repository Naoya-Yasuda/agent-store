-- AgentCard schema migration (draft)
CREATE TABLE IF NOT EXISTS agent_cards (
    id UUID PRIMARY KEY,
    agent_id UUID NOT NULL,
    default_locale TEXT NOT NULL,
    icon_url TEXT,
    banner_url TEXT,
    status TEXT NOT NULL,
    pricing_type TEXT,
    pricing_details TEXT,
    compliance_notes TEXT,
    last_reviewed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agent_card_translations (
    card_id UUID REFERENCES agent_cards(id) ON DELETE CASCADE,
    locale TEXT NOT NULL,
    display_name TEXT NOT NULL,
    short_description TEXT NOT NULL,
    long_description TEXT,
    capabilities TEXT[] NOT NULL,
    use_cases TEXT[],
    PRIMARY KEY(card_id, locale)
);

CREATE TABLE IF NOT EXISTS agent_card_tags (
    card_id UUID REFERENCES agent_cards(id) ON DELETE CASCADE,
    tag TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agent_cards_agent_id ON agent_cards(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_card_tags_tag ON agent_card_tags(tag);
