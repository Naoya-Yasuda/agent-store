import { randomUUID, createHash } from 'crypto';
import { getDbPool } from '../db/pool';
import { SubmissionPayload } from '../utils/submissionValidator';
import { stableStringify } from '../utils/json';

export type SubmissionState = 'precheck_pending';

export interface SubmissionRecord {
  id: string;
  state: SubmissionState;
  createdAt: string;
  manifestWarnings: string[];
}

export async function insertSubmission(payload: SubmissionPayload, manifestWarnings: string[], requestContext: Record<string, string | undefined>): Promise<SubmissionRecord> {
  const pool = getDbPool();
  const client = await pool.connect();
  const submissionId = randomUUID();
  const state: SubmissionState = 'precheck_pending';
  const createdAt = new Date().toISOString();
  const snapshotHash = createHash('sha256').update(stableStringify(payload.endpointManifest)).digest('hex');

  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO submissions (id, agent_id, card_document, endpoint_manifest, endpoint_snapshot_hash, signature_bundle, organization_meta, state, manifest_warnings, request_context, created_at)
       VALUES ($1, $2, $3::jsonb, $4::jsonb, $5, $6::jsonb, $7::jsonb, $8, $9::text[], $10::jsonb, $11)
      `,
      [
        submissionId,
        payload.agentId,
        JSON.stringify(payload.cardDocument),
        JSON.stringify(payload.endpointManifest),
        snapshotHash,
        JSON.stringify(payload.signatureBundle),
        JSON.stringify(payload.organization),
        state,
        manifestWarnings,
        JSON.stringify(requestContext),
        createdAt
      ]
    );
    if (payload.cardDocument.endpointRelayId) {
      await client.query(
        `INSERT INTO agent_endpoint_snapshots (id, agent_id, relay_id, manifest, snapshot_hash, created_at)
         VALUES ($1, $2, $3, $4::jsonb, $5, $6)
         ON CONFLICT (relay_id) DO UPDATE SET manifest = EXCLUDED.manifest, snapshot_hash = EXCLUDED.snapshot_hash, updated_at = now()
        `,
        [
          randomUUID(),
          payload.agentId,
          payload.cardDocument.endpointRelayId,
          JSON.stringify(payload.endpointManifest),
          snapshotHash,
          createdAt
        ]
      );
    }
    await client.query('COMMIT');
    return {
      id: submissionId,
      state,
      createdAt,
      manifestWarnings
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
