import { SubmissionPayload } from '../utils/submissionValidator';
import { insertSubmission, SubmissionRecord } from '../repositories/submissionRepository';

export interface SubmissionRequestContext {
  ip?: string;
  userAgent?: string;
  requestId?: string;
}

export async function createSubmission(payload: SubmissionPayload, manifestWarnings: string[], requestContext: SubmissionRequestContext): Promise<SubmissionRecord> {
  return insertSubmission(payload, manifestWarnings, requestContext);
}
