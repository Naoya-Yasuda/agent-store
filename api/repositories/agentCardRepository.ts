import { PoolClient } from 'pg';
import { AgentCard, AgentCardStatus, AgentExecutionProfile, PricingInfo } from '../../prototype/temporal-review-workflow/src/types/agentCard';
import { getDbPool } from '../db/pool';

type AgentCardRow = {
  id: string;
  agent_id: string;
  default_locale: string;
  icon_url: string | null;
  banner_url: string | null;
  pricing_type: string | null;
  pricing_details: string | null;
  compliance_notes: string | null;
  last_reviewed_at: string | null;
  status: string;
  status_reason: string | null;
  execution_profile: string;
  endpoint_relay_id: string | null;
  provider_registry_ids: string[] | null;
};

type AgentCardTranslationRow = {
  locale: string;
  display_name: string;
  short_description: string;
  long_description: string | null;
  capabilities: string[];
  use_cases: string[] | null;
};

export async function upsertAgentCard(card: AgentCard): Promise<void> {
  const pool = getDbPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO agent_cards (id, agent_id, default_locale, icon_url, banner_url, status, status_reason, pricing_type, pricing_details, compliance_notes, last_reviewed_at, execution_profile, endpoint_relay_id, provider_registry_ids)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       ON CONFLICT (id)
       DO UPDATE SET icon_url = EXCLUDED.icon_url,
                     banner_url = EXCLUDED.banner_url,
                     status = EXCLUDED.status,
                     status_reason = EXCLUDED.status_reason,
                     pricing_type = EXCLUDED.pricing_type,
                     pricing_details = EXCLUDED.pricing_details,
                     compliance_notes = EXCLUDED.compliance_notes,
                     last_reviewed_at = EXCLUDED.last_reviewed_at,
                     execution_profile = EXCLUDED.execution_profile,
                     endpoint_relay_id = EXCLUDED.endpoint_relay_id,
                     provider_registry_ids = EXCLUDED.provider_registry_ids,
                     updated_at = now()
      `,
      [
        card.id,
        card.agentId,
        card.defaultLocale,
        card.iconUrl,
        card.bannerUrl,
        card.status,
        card.statusReason ?? null,
        card.pricing?.type,
        card.pricing?.details,
        card.complianceNotes,
        card.lastReviewedAt ?? null,
        card.executionProfile,
        card.endpointRelayId ?? null,
        card.providerRegistryIds ?? null
      ]
    );

    await client.query('DELETE FROM agent_card_translations WHERE card_id = $1', [card.id]);
    for (const translation of card.translations) {
      await client.query(
        `INSERT INTO agent_card_translations (card_id, locale, display_name, short_description, long_description, capabilities, use_cases)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`
      , [
        card.id,
        translation.locale,
        translation.displayName,
        translation.shortDescription,
        translation.longDescription ?? null,
        translation.capabilities,
        translation.useCases ?? null
      ]);
    }

    await client.query('DELETE FROM agent_card_tags WHERE card_id = $1', [card.id]);
    const tags = new Set<string>();
    for (const translation of card.translations) {
      for (const capability of translation.capabilities) {
        tags.add(capability);
      }
      if (translation.useCases) {
        for (const useCase of translation.useCases) {
          tags.add(useCase);
        }
      }
    }
    for (const tag of tags) {
      await client.query('INSERT INTO agent_card_tags (card_id, tag) VALUES ($1, $2)', [card.id, tag]);
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function fetchAgentCards(): Promise<AgentCard[]> {
  const pool = getDbPool();
  const client = await pool.connect();
  try {
    const cardsResult = await client.query<AgentCardRow>('SELECT * FROM agent_cards');
    const cards: AgentCard[] = [];
    for (const row of cardsResult.rows) {
      const translationsResult = await client.query<AgentCardTranslationRow>(
        'SELECT * FROM agent_card_translations WHERE card_id = $1',
        [row.id]
      );
      const pricing: PricingInfo | undefined = row.pricing_type
        ? { type: row.pricing_type as PricingInfo['type'], details: row.pricing_details ?? undefined }
        : undefined;
      cards.push({
        id: row.id,
        agentId: row.agent_id,
        defaultLocale: row.default_locale,
        translations: translationsResult.rows.map((t) => ({
          locale: t.locale,
          displayName: t.display_name,
          shortDescription: t.short_description,
          longDescription: t.long_description ?? undefined,
          capabilities: t.capabilities,
          useCases: t.use_cases ?? undefined
        })),
        iconUrl: row.icon_url ?? undefined,
        bannerUrl: row.banner_url ?? undefined,
        pricing,
        complianceNotes: row.compliance_notes ?? undefined,
        lastReviewedAt: row.last_reviewed_at ?? undefined,
        status: row.status as AgentCardStatus,
        statusReason: row.status_reason ?? undefined,
        executionProfile: row.execution_profile as AgentExecutionProfile,
        endpointRelayId: row.endpoint_relay_id ?? undefined,
        providerRegistryIds: row.provider_registry_ids ?? undefined
      });
    }
    return cards;
  } finally {
    client.release();
  }
}

export async function fetchAgentCardByAgentId(agentId: string): Promise<AgentCard | undefined> {
  const pool = getDbPool();
  const client = await pool.connect();
  try {
    const cardResult = await client.query<AgentCardRow>('SELECT * FROM agent_cards WHERE agent_id = $1 LIMIT 1', [agentId]);
    if (cardResult.rowCount === 0) {
      return undefined;
    }
    const row = cardResult.rows[0];
    const translationsResult = await client.query<AgentCardTranslationRow>(
      'SELECT * FROM agent_card_translations WHERE card_id = $1',
      [row.id]
    );
    const pricing: PricingInfo | undefined = row.pricing_type
      ? { type: row.pricing_type as PricingInfo['type'], details: row.pricing_details ?? undefined }
      : undefined;
    return {
      id: row.id,
      agentId: row.agent_id,
      defaultLocale: row.default_locale,
      translations: translationsResult.rows.map((t) => ({
        locale: t.locale,
        displayName: t.display_name,
        shortDescription: t.short_description,
        longDescription: t.long_description ?? undefined,
        capabilities: t.capabilities,
        useCases: t.use_cases ?? undefined
      })),
      iconUrl: row.icon_url ?? undefined,
      bannerUrl: row.banner_url ?? undefined,
      pricing,
      complianceNotes: row.compliance_notes ?? undefined,
      lastReviewedAt: row.last_reviewed_at ?? undefined,
      status: row.status as AgentCardStatus,
      statusReason: row.status_reason ?? undefined,
      executionProfile: row.execution_profile as AgentExecutionProfile,
      endpointRelayId: row.endpoint_relay_id ?? undefined,
      providerRegistryIds: row.provider_registry_ids ?? undefined
    };
  } finally {
    client.release();
  }
}
