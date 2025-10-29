export type AgentCardStatus = 'draft' | 'published' | 'suspended';

export interface PricingInfo {
  type: 'free' | 'subscription' | 'usage';
  details?: string;
}

export interface AgentCardTranslation {
  locale: string;
  displayName: string;
  shortDescription: string;
  longDescription?: string;
  capabilities: string[];
  useCases?: string[];
}

export interface AgentCard {
  id: string;
  agentId: string;
  defaultLocale: string;
  translations: AgentCardTranslation[];
  iconUrl?: string;
  bannerUrl?: string;
  pricing?: PricingInfo;
  complianceNotes?: string;
  lastReviewedAt?: string;
  status: AgentCardStatus;
}
