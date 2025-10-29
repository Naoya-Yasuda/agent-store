import { readFileSync } from 'fs';
import path from 'path';
import { Draft2020Validator, JsonSchema } from 'jsonschema-library';

const schemaPath = path.resolve(__dirname, '..', '..', 'schemas', 'agent-card.schema.json');
const schemaJson = JSON.parse(readFileSync(schemaPath, 'utf8')) as JsonSchema;
const validator = new Draft2020Validator();
validator.addSchema(schemaJson, schemaJson.$id ?? 'agent-card');

export function validateAgentCardPayload(payload: unknown): { valid: boolean; errors?: string[] } {
  const result = validator.validate(payload, 'agent-card');
  if (result === true) {
    return { valid: true };
  }
  return {
    valid: false,
    errors: result
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
  };
}
