import { readFileSync } from 'fs';
import path from 'path';
import Ajv, { ErrorObject } from 'ajv';

const schemaPath = path.resolve(__dirname, '..', '..', 'schemas', 'agent-card.schema.json');
const schemaJson = JSON.parse(readFileSync(schemaPath, 'utf8'));
const ajv = new Ajv({ allErrors: true, strict: false, validateSchema: false });
const validateAgentCard = ajv.compile(schemaJson);

export function validateAgentCardPayload(payload: unknown): { valid: boolean; errors?: string[] } {
  const ok = validateAgentCard(payload);
  if (ok) {
    return { valid: true };
  }
  const errors = formatAjvErrors(validateAgentCard.errors);
  return {
    valid: false,
    errors
  };
}

function formatAjvErrors(errors: ErrorObject[] | null | undefined): string[] {
  if (!errors) {
    return ['agentCard validation failed'];
  }
  return errors.map((err) => {
    const path = err.instancePath ? err.instancePath.replace(/^\//, '').replace(/\//g, '.') : '(root)';
    return `${path}: ${err.message ?? 'invalid'}`;
  });
}
