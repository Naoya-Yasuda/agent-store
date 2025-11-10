import { AgentCard } from '../../prototype/temporal-review-workflow/src/types/agentCard';

export interface EndpointManifest {
  openapi?: string;
  info?: { title?: string; version?: string };
  paths?: Record<string, Record<string, ManifestOperation>>;
  servers?: Array<{ url: string }>;
}

interface ManifestOperation {
  summary?: string;
  description?: string;
  tags?: string[];
}

export interface ManifestConsistencyResult {
  valid: boolean;
  errors?: string[];
  warnings?: string[];
}

export function checkManifestAgainstCard(manifest: EndpointManifest, card: AgentCard): ManifestConsistencyResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!manifest.openapi) {
    errors.push('manifest.openapi is required');
  }
  if (!manifest.paths || Object.keys(manifest.paths).length === 0) {
    errors.push('manifest.paths must include at least one path');
  }

  const translation = card.translations.find((t) => t.locale === card.defaultLocale) ?? card.translations[0];
  if (translation) {
    for (const capability of translation.capabilities) {
      if (!capability) {
        continue;
      }
      if (!manifestIncludesCapability(manifest, capability)) {
        warnings.push(`capability "${capability}" not reflected in manifest summaries or tags`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors: errors.length ? errors : undefined,
    warnings: warnings.length ? warnings : undefined
  };
}

function manifestIncludesCapability(manifest: EndpointManifest, capability: string): boolean {
  const needle = capability.toLowerCase();
  if (!manifest.paths) {
    return false;
  }
  for (const path of Object.keys(manifest.paths)) {
    const operations = manifest.paths[path];
    for (const method of Object.keys(operations)) {
      const op = operations[method];
      const haystack = [op.summary, op.description, ...(op.tags ?? [])]
        .filter(Boolean)
        .join(' ') 
        .toLowerCase();
      if (haystack.includes(needle)) {
        return true;
      }
    }
  }
  return false;
}
