import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { getWorkflowProgress, getLedgerSummary, getLedgerEntryFile, getStageEvents, requestHumanDecision, requestStageRetry } from '../services/reviewService';
import { StageName } from '../types/reviewTypes';

const router = Router();

function escapeHtml(input: unknown): string {
  return String(input ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function readJsonlPreview(filePath: string, limit = 8): any[] {
  try {
    if (!fs.existsSync(filePath)) {
      return [];
    }
    const lines = fs.readFileSync(filePath, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, limit);
    return lines.map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return { raw: line };
      }
    });
  } catch {
    return [];
  }
}

const stageLabels: Record<string, string> = {
  precheck: 'PreCheck',
  security: 'Security Gate',
  functional: 'Functional Accuracy',
  judge: 'Judge Panel',
  human: 'Human Review',
  publish: 'Publish'
};

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
    const stageRows = stagesEntries.map(([stage, info]) => `<tr><td>${escapeHtml(stage)}</td><td>${escapeHtml(info?.status ?? 'unknown')}</td><td>${escapeHtml(info?.attempts ?? 0)}</td><td>${escapeHtml(info?.message ?? '')}</td></tr>`).join('');
    const stageOptions = stagesEntries.map(([stage]) => `<option value="${escapeHtml(stage)}">${escapeHtml(stage)}</option>`).join('');
    const wandbLink = progress.wandbRun?.url
      ? `<a href="${escapeHtml(progress.wandbRun.url)}" target="_blank" rel="noreferrer">W&B Dashboard</a>`
      : 'N/A';
    const llm = progress.llmJudge;
    const llmInfo = llm
      ? `<table><tbody>
            <tr><td>Enabled</td><td>${llm.enabled ? 'ON' : 'OFF'}</td></tr>
            <tr><td>Model</td><td>${escapeHtml(llm.model ?? 'N/A')}</td></tr>
            <tr><td>Provider</td><td>${escapeHtml(llm.provider ?? 'N/A')}</td></tr>
            <tr><td>Temperature</td><td>${escapeHtml(llm.temperature ?? '-')}</td></tr>
            <tr><td>Max Tokens</td><td>${escapeHtml(llm.maxOutputTokens ?? '-')}</td></tr>
            <tr><td>Dry Run</td><td>${llm.dryRun ? 'true' : 'false'}</td></tr>
          </tbody></table>`
      : 'LLM Judge: 未設定';
    const judgeDetails = progress.stages?.judge?.details ?? {};
    const judgeSummary = judgeDetails.summary ?? {};
    const judgeTable = Object.keys(judgeSummary).length
      ? `<div style="margin-top:8px;background:#fff;border:1px solid #d0d7de;border-radius:8px;padding:12px;">
          <h3>Judge Panel 統計</h3>
          <table>
            <tbody>
              <tr><td>Questions</td><td>${escapeHtml(judgeSummary.questions ?? '-')}</td></tr>
              <tr><td>Approved</td><td>${escapeHtml(judgeSummary.approved ?? '-')}</td></tr>
              <tr><td>Manual</td><td>${escapeHtml(judgeSummary.manual ?? '-')}</td></tr>
              <tr><td>Rejected</td><td>${escapeHtml(judgeSummary.rejected ?? '-')}</td></tr>
              <tr><td>Flagged</td><td>${escapeHtml(judgeSummary.flagged ?? '-')}</td></tr>
              <tr><td>Relay Errors</td><td>${escapeHtml(judgeSummary.relayErrors ?? 0)}</td></tr>
            </tbody>
          </table>
        </div>`
      : '';
    const agentId = progress.agentId;
    const agentRevisionId = progress.agentRevisionId;
    let judgeCardsHtml = '';
    let relayPreviewHtml = '';
    if (agentId && agentRevisionId) {
      const judgeDir = path.join(__dirname, '..', '..', 'prototype', 'inspect-worker', 'out', agentId, agentRevisionId, 'judge');
      const reportRecords = readJsonlPreview(path.join(judgeDir, 'judge_report.jsonl'), 6);
      const relayRecords = readJsonlPreview(path.join(judgeDir, 'relay_logs.jsonl'), 6);
      if (reportRecords.length) {
        judgeCardsHtml = `<div style="margin-top:12px;">
            <h3>LLM Verdict Cards</h3>
            <div class="card-grid">
              ${reportRecords.map((item) => `
                <div class="judge-card">
                  <div class="judge-card__title">${escapeHtml(item.questionId ?? 'unknown')}</div>
                  <div class="judge-card__meta">Verdict: ${escapeHtml(item.verdict ?? 'n/a')}</div>
                  <div class="judge-card__meta">LLM Verdict: ${escapeHtml(item.llmVerdict ?? 'n/a')}</div>
                  <div class="judge-card__score">LLM Score: ${escapeHtml(item.llmScore ?? '-')}</div>
                  ${item.llmRationale ? `<details><summary>LLM Rationale</summary><pre>${escapeHtml(item.llmRationale)}</pre></details>` : ''}
                </div>
              `).join('')}
            </div>
          </div>`;
      }
      if (relayRecords.length) {
        relayPreviewHtml = `<div style="margin-top:12px;">
            <h3>Relay Logs</h3>
            <div class="relay-list">
              ${relayRecords.map((item) => `
                <div class="relay-item">
                  <div class="relay-item__head">${escapeHtml(item.questionId ?? 'unknown')} (${escapeHtml(item.status ?? 'n/a')})</div>
                  <div class="relay-item__meta">latency: ${escapeHtml(Math.round(item.latencyMs ?? 0))} ms / http: ${escapeHtml(item.httpStatus ?? 'n/a')}</div>
                  ${item.error ? `<div class="relay-item__error">${escapeHtml(item.error)}</div>` : ''}
                  ${item.response ? `<pre>${escapeHtml(item.response)}</pre>` : ''}
                </div>
              `).join('')}
            </div>
          </div>`;
      }
    }
    const judgeInsights = judgeCardsHtml || relayPreviewHtml
      ? `<section style="margin-top:16px;">${judgeCardsHtml}${relayPreviewHtml}</section>`
      : '';
    const ledgerEntries = stagesEntries
      .map(([stage, info]) => {
        const ledger = info?.details?.ledger;
        if (!ledger?.entryPath && !ledger?.digest) {
          return null;
        }
        return { stage, ledger };
      })
      .filter(Boolean) as { stage: string; ledger: { entryPath?: string; digest?: string } }[];
    const ledgerHtml = ledgerEntries.length
      ? `<section style="margin-top:16px;">
          <h3>Ledger 記録</h3>
          <div class="ledger-grid">
            ${ledgerEntries.map((entry) => {
              const entryPath = entry.ledger.entryPath;
              const digest = entry.ledger.digest ? `<code>${escapeHtml(entry.ledger.digest)}</code>` : 'N/A';
              const link = entryPath
                ? (entryPath.startsWith('http://') || entryPath.startsWith('https://')
                    ? `<a href="${escapeHtml(entryPath)}" target="_blank" rel="noreferrer">Ledger Link</a>`
                    : `<code>${escapeHtml(entryPath)}</code>`)
                : 'N/A';
              return `
                <div class="ledger-card">
                  <div class="ledger-card__title">${escapeHtml(stageLabels[entry.stage as keyof typeof stageLabels] ?? entry.stage)}</div>
                  <div>Entry: ${link}</div>
                  <div>Digest: ${digest}</div>
                </div>`;
            }).join('')}
          </div>
        </section>`
      : '';
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Review Progress</title>
      <style>
        body{font-family:system-ui, sans-serif;padding:24px;background:#f6f8fa;}
        table{border-collapse:collapse;width:100%;margin-top:16px;}th,td{border:1px solid #d0d7de;padding:8px;text-align:left;}th{background:#eaeef2;}
        form{margin-top:16px;padding:16px;background:#fff;border:1px solid #d0d7de;border-radius:8px;}
        label{display:block;margin-bottom:8px;font-weight:600;}
        input,select,textarea{width:100%;padding:8px;margin-bottom:12px;border:1px solid #d0d7de;border-radius:6px;}
        button{padding:8px 16px;border:none;border-radius:6px;background:#0969da;color:#fff;cursor:pointer;}
        button.secondary{background:#d1242f;}
        .card-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;}
        .judge-card{background:#fff;border:1px solid #d0d7de;border-radius:10px;padding:12px;box-shadow:0 1px 2px rgba(15,23,42,0.08);}
        .judge-card__title{font-weight:600;margin-bottom:4px;}
        .judge-card__meta{font-size:13px;color:#57606a;}
        .judge-card__score{margin-top:4px;font-weight:600;}
        .judge-card details{margin-top:8px;}
        .judge-card pre{white-space:pre-wrap;background:#0f172a;color:#e2e8f0;padding:8px;border-radius:6px;}
        .relay-list{max-height:320px;overflow:auto;border:1px solid #d0d7de;border-radius:10px;background:#fff;}
        .relay-item{padding:12px;border-bottom:1px solid #eaeef2;}
        .relay-item__head{font-weight:600;}
        .relay-item__meta{font-size:12px;color:#57606a;}
        .relay-item__error{color:#d1242f;font-size:13px;margin-top:4px;}
        .relay-item pre{white-space:pre-wrap;background:#0f172a;color:#e2e8f0;padding:8px;border-radius:6px;}
        .ledger-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;}
        .ledger-card{background:#fff;border:1px solid #d0d7de;border-radius:8px;padding:12px;}
        .ledger-card__title{font-weight:600;margin-bottom:4px;}
      </style>
      </head><body>
      <h1>Submission ${req.params.submissionId}</h1>
      <p>状態: ${progress.terminalState}</p>
      <p>W&B: ${wandbLink}</p>
      <div style="margin-top:8px; padding:12px; background:#fff; border:1px solid #d0d7de; border-radius:8px;">
        <h3>LLM Judge設定</h3>
        ${llmInfo}
      </div>
      ${judgeTable}
      ${judgeInsights}
      ${ledgerHtml}
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
  const { submissionId, stage, reason, llmOverride } = req.body ?? {};
  if (!submissionId || !stage || !reason) {
    return res.status(400).json({ error: 'missing_fields' });
  }
  try {
    const normalizedStage = stage as StageName;
    const override = normalizeLlmOverride(llmOverride);
    await requestStageRetry(submissionId, normalizedStage, reason, { llmOverride: override });
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

router.get('/review/ledger/:submissionId', async (req: Request, res: Response) => {
  try {
    const entries = await getLedgerSummary(req.params.submissionId);
    res.json({ submissionId: req.params.submissionId, entries });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown_error';
    res.status(500).json({ error: 'ledger_fetch_failed', message });
  }
});

router.get('/review/events/:submissionId', async (req: Request, res: Response) => {
  try {
    const result = await getStageEvents(req.params.submissionId);
    if (!result) {
      return res.status(404).json({ error: 'workflow_not_found' });
    }
    res.json({ submissionId: req.params.submissionId, events: result.events, agentRevisionId: result.agentRevisionId });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown_error';
    res.status(500).json({ error: 'events_fetch_failed', message });
  }
});

router.get('/review/ledger/download', async (req: Request, res: Response) => {
  const submissionId = req.query.submissionId as string | undefined;
  const stage = req.query.stage as string | undefined;
  if (!submissionId || !stage) {
    return res.status(400).json({ error: 'missing_params' });
  }
  if (!isStageName(stage)) {
    return res.status(400).json({ error: 'invalid_stage' });
  }
  try {
    const fileHandle = await getLedgerEntryFile(submissionId, stage as StageName);
    if (!fileHandle) {
      return res.status(404).json({ error: 'ledger_file_not_found', submissionId, stage });
    }
    if (!fileHandle.exists) {
      return res.status(404).json({
        error: 'ledger_file_not_found',
        submissionId,
        stage,
        sourceFile: fileHandle.relativePath,
        fallback: fileHandle.fallback ?? false
      });
    }
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=${stage}-ledger.json`);
    res.setHeader('X-Ledger-Source', fileHandle.relativePath);
    if (fileHandle.fallback) {
      res.setHeader('X-Ledger-Fallback', 'true');
    }
    fs.createReadStream(fileHandle.absolutePath).pipe(res);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown_error';
    res.status(500).json({ error: 'ledger_download_failed', message });
  }
});

function normalizeLlmOverride(input: unknown): LlmJudgeOverride | undefined {
  if (!input || typeof input !== 'object') {
    return undefined;
  }
  const source = input as Record<string, unknown>;
  const override: LlmJudgeOverride = {};
  if (typeof source.model === 'string') override.model = source.model;
  if (typeof source.provider === 'string') override.provider = source.provider;
  if (typeof source.baseUrl === 'string') override.baseUrl = source.baseUrl;
  if (typeof source.enabled === 'boolean') override.enabled = source.enabled;
  if (typeof source.dryRun === 'boolean') override.dryRun = source.dryRun;
  if (typeof source.temperature === 'number') override.temperature = source.temperature;
  if (typeof source.maxOutputTokens === 'number') override.maxOutputTokens = source.maxOutputTokens;
  return Object.keys(override).length ? override : undefined;
}

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
const stageNameList: StageName[] = ['precheck', 'security', 'functional', 'judge', 'human', 'publish'];

function isStageName(value: string): value is StageName {
  return stageNameList.includes(value as StageName);
}
