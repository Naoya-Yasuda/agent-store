import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
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
    const stagesEntries = Object.entries(progress.stages ?? {}) as [string, any][];
    const stageRows = stagesEntries.map(([stage, info]) => `<tr><td>${stage}</td><td>${info?.status ?? 'unknown'}</td><td>${info?.attempts ?? 0}</td><td>${info?.message ?? ''}</td></tr>`).join('');
    const stageOptions = stagesEntries.map(([stage]) => `<option value="${stage}">${stage}</option>`).join('');
    const wandbLink = progress.wandbRun?.url
      ? `<a href="${progress.wandbRun.url}" target="_blank" rel="noreferrer">W&B Dashboard</a>`
      : 'N/A';
    const llm = progress.llmJudge;
    const llmInfo = llm
      ? `<table><tbody>
            <tr><td>Enabled</td><td>${llm.enabled ? 'ON' : 'OFF'}</td></tr>
            <tr><td>Model</td><td>${llm.model ?? 'N/A'}</td></tr>
            <tr><td>Provider</td><td>${llm.provider ?? 'N/A'}</td></tr>
            <tr><td>Temperature</td><td>${llm.temperature ?? '-'}</td></tr>
            <tr><td>Max Tokens</td><td>${llm.maxOutputTokens ?? '-'}</td></tr>
            <tr><td>Dry Run</td><td>${llm.dryRun ? 'true' : 'false'}</td></tr>
          </tbody></table>`
      : 'LLM Judge: 未設定';
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Review Progress</title>
      <style>
        body{font-family:system-ui, sans-serif;padding:24px;background:#f6f8fa;}
        table{border-collapse:collapse;width:100%;margin-top:16px;}th,td{border:1px solid #d0d7de;padding:8px;text-align:left;}th{background:#eaeef2;}
        form{margin-top:16px;padding:16px;background:#fff;border:1px solid #d0d7de;border-radius:8px;}
        label{display:block;margin-bottom:8px;font-weight:600;}
        input,select,textarea{width:100%;padding:8px;margin-bottom:12px;border:1px solid #d0d7de;border-radius:6px;}
        button{padding:8px 16px;border:none;border-radius:6px;background:#0969da;color:#fff;cursor:pointer;}
        button.secondary{background:#d1242f;}
      </style>
      </head><body>
      <h1>Submission ${req.params.submissionId}</h1>
      <p>状態: ${progress.terminalState}</p>
      <p>W&B: ${wandbLink}</p>
      <div style="margin-top:8px; padding:12px; background:#fff; border:1px solid #d0d7de; border-radius:8px;">
        <h3>LLM Judge設定</h3>
        ${llmInfo}
      </div>
      <table><thead><tr><th>ステージ</th><th>状態</th><th>試行数</th><th>メッセージ</th></tr></thead><tbody>${stageRows}</tbody></table>
      <form id="retry-form">
        <h2>ステージ再実行</h2>
        <label>対象ステージ<select name="stage">${stageOptions}</select></label>
        <label>理由<textarea name="reason" rows="3" required></textarea></label>
        <button type="submit">再実行リクエスト</button>
        <p id="retry-status"></p>
      </form>
      <form id="decision-form">
        <h2>Human Review 決定</h2>
        <label>メモ<textarea name="notes" rows="3"></textarea></label>
        <button type="button" data-decision="approved">承認</button>
        <button type="button" class="secondary" data-decision="rejected">差戻し</button>
        <p id="decision-status"></p>
      </form>
      <script>
        const submissionId = ${JSON.stringify(req.params.submissionId)};
        document.getElementById('retry-form').addEventListener('submit', async (event) => {
          event.preventDefault();
          const form = event.target;
          const stage = form.elements.stage.value;
          const reason = form.elements.reason.value;
          const statusEl = document.getElementById('retry-status');
          statusEl.textContent = '送信中...';
          try {
            const res = await fetch('/review/retry', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ submissionId, stage, reason })
            });
            const data = await res.json();
            statusEl.textContent = res.ok ? '再実行リクエスト済み' : data.error || 'エラー';
          } catch (err) {
            statusEl.textContent = '通信エラー';
          }
        });
        document.querySelectorAll('#decision-form button').forEach((button) => {
          button.addEventListener('click', async () => {
            const decision = button.getAttribute('data-decision');
            const notes = document.querySelector('#decision-form textarea').value;
            const statusEl = document.getElementById('decision-status');
            statusEl.textContent = '送信中...';
            try {
              const res = await fetch('/review/decision', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ submissionId, decision, notes })
              });
              const data = await res.json();
              statusEl.textContent = res.ok ? '決定を送信しました' : data.error || 'エラー';
            } catch (err) {
              statusEl.textContent = '通信エラー';
            }
          });
        });
      </script>
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

router.get('/review/artifacts/:agentRevisionId', async (req: Request, res: Response) => {
  const { stage = 'security', type = 'report', agentId } = req.query;
  const revision = req.params.agentRevisionId as string;
  const baseDir = path.resolve(__dirname, '..', '..', 'sandbox-runner', 'artifacts', revision);
  const judgeBase = path.join(__dirname, '..', '..', 'prototype', 'inspect-worker', 'out', String(agentId ?? 'unknown'), revision, 'judge');
  if (String(stage) === 'judge' && !agentId) {
    return res.status(400).json({ error: 'agent_id_required' });
  }
  const mapping: Record<string, Record<string, string>> = {
    security: {
      report: path.join(baseDir, 'security', 'security_report.jsonl'),
      summary: path.join(baseDir, 'security', 'security_summary.json'),
      metadata: path.join(baseDir, 'metadata.json'),
      prompts: path.join(baseDir, 'security', 'security_prompts.jsonl')
    },
    functional: {
      report: path.join(baseDir, 'functional', 'functional_report.jsonl'),
      summary: path.join(baseDir, 'functional', 'functional_summary.json'),
      metadata: path.join(baseDir, 'metadata.json'),
      prompts: path.join(baseDir, 'functional', 'functional_scenarios.jsonl')
    },
    judge: {
      report: path.join(judgeBase, 'judge_report.jsonl'),
      summary: path.join(judgeBase, 'judge_summary.json'),
      relay: path.join(judgeBase, 'relay_logs.jsonl')
    }
  };
  const stageKey = String(stage);
  const stageMap = mapping[stageKey] || mapping.security;
  const fileKey = String(type);
  const filePath = stageMap[fileKey] ?? stageMap.report;
  try {
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'artifact_not_found' });
    }
    const ext = path.extname(filePath);
    if (ext === '.jsonl') {
      res.setHeader('Content-Type', 'application/jsonl; charset=utf-8');
    } else {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
    }
    fs.createReadStream(filePath).pipe(res);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown_error';
    res.status(500).json({ error: 'artifact_fetch_failed', message });
  }
});

export default router;
