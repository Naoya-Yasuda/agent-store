import { Router, Request, Response } from 'express';
import { getWorkflowProgress, requestHumanDecision, requestStageRetry } from '../services/reviewService';

const router = Router();

router.get('/review/progress/:submissionId', async (req: Request, res: Response) => {
  try {
    const progress = await getWorkflowProgress(req.params.submissionId);
    res.json(progress);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown_error';
    res.status(500).json({ error: 'progress_fetch_failed', message });
  }
});

router.get('/review/ui/:submissionId', async (req: Request, res: Response) => {
  try {
    const progress = await getWorkflowProgress(req.params.submissionId);
    if (!progress) {
      return res.status(404).send('workflow not found');
    }
    const stagesHtml = Object.entries(progress.stages ?? {})
      .map(([stage, info]: [string, any]) => {
        return `<tr><td>${stage}</td><td>${info?.status ?? 'unknown'}</td><td>${info?.attempts ?? 0}</td><td>${info?.message ?? ''}</td></tr>`;
      })
      .join('');
    const wandbLink = progress.wandbRun?.url
      ? `<a href="${progress.wandbRun.url}" target="_blank" rel="noreferrer">W&B Dashboard</a>`
      : 'N/A';
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Review Progress</title>
      <style>body{font-family:system-ui, sans-serif;padding:24px;background:#f6f8fa;}table{border-collapse:collapse;width:100%;margin-top:16px;}th,td{border:1px solid #d0d7de;padding:8px;text-align:left;}th{background:#eaeef2;}</style>
      </head><body>
      <h1>Submission ${req.params.submissionId}</h1>
      <p>状態: ${progress.terminalState}</p>
      <p>W&B: ${wandbLink}</p>
      <table><thead><tr><th>ステージ</th><th>状態</th><th>試行数</th><th>メッセージ</th></tr></thead><tbody>${stagesHtml}</tbody></table>
      </body></html>`;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown_error';
    res.status(500).send(`progress_fetch_failed: ${message}`);
  }
});

router.post('/review/retry', async (req: Request, res: Response) => {
  const { submissionId, stage, reason } = req.body ?? {};
  if (!submissionId || !stage || !reason) {
    return res.status(400).json({ error: 'missing_fields' });
  }
  try {
    await requestStageRetry(submissionId, stage, reason);
    res.status(202).json({ status: 'retry_requested' });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown_error';
    res.status(500).json({ error: 'retry_failed', message });
  }
});

router.post('/review/decision', async (req: Request, res: Response) => {
  const { submissionId, decision, notes } = req.body ?? {};
  if (!submissionId || !decision) {
    return res.status(400).json({ error: 'missing_fields' });
  }
  try {
    await requestHumanDecision(submissionId, decision, notes);
    res.status(202).json({ status: 'decision_submitted' });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown_error';
    res.status(500).json({ error: 'decision_failed', message });
  }
});

export default router;
