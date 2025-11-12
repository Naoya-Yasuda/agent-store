import { test, expect } from '@playwright/test';
import progress from '../fixtures/progress-manual.json';
import ledgerEntries from '../fixtures/ledger-summary.json';
import events from '../fixtures/events.json';
import judgeReport from '../fixtures/judge-report.json';
import judgeRelay from '../fixtures/judge-relay.json';

const submissionId = 'demo';

const jsonResponse = (data: unknown) => ({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify(data)
});

test.beforeEach(async ({ page }) => {
  await page.route('**/review/progress/**', async (route) => {
    await route.fulfill(jsonResponse(progress));
  });
  await page.route('**/review/ledger/**', async (route) => {
    await route.fulfill(jsonResponse({ submissionId, entries: ledgerEntries }));
  });
  await page.route('**/review/events/**', async (route) => {
    await route.fulfill(jsonResponse({ submissionId, events }));
  });
  await page.route('**/review/artifacts/**', async (route) => {
    const url = new URL(route.request().url());
    const type = url.searchParams.get('type');
    if (type === 'report') {
      await route.fulfill(jsonResponse(judgeReport));
      return;
    }
    if (type === 'relay') {
      await route.fulfill(jsonResponse(judgeRelay));
      return;
    }
    await route.fulfill(jsonResponse({}));
  });
});

const getRetryForm = (page: any) => ({
  provider: page.getByLabel('プロバイダ'),
  model: page.getByLabel('モデル'),
  temperature: page.getByLabel('温度 (0.0〜2.0)'),
  maxTokens: page.getByLabel('Max Tokens (1〜8192)'),
  baseUrl: page.getByLabel('Base URL', { exact: false })
});

const waitForProgress = (page: any) =>
  page.waitForResponse((res: any) => res.url().includes('/review/progress/') && res.status() === 200);

const loadJudgeArtifacts = async (page: any) => {
  const evidenceSection = page.locator('section').filter({ has: page.locator('h2', { hasText: '証拠ビューア' }) }).first();
  const stageSelect = evidenceSection.locator('label:has-text("ステージ") select').first();
  await stageSelect.selectOption({ label: 'Judge Panel' });
  const typeSelect = evidenceSection.locator('label:has-text("種別") select').first();
  await typeSelect.selectOption('report');
  const responsePromise = page.waitForResponse((res: any) => res.url().includes('type=report') && res.status() === 200);
  await evidenceSection.getByRole('button', { name: 'APIから再取得' }).click();
  await responsePromise;
};

test('manual banner presets LLM override from question card', async ({ page }) => {
  await page.goto('/');
  await page.fill('label:has-text("Submission ID") >> input', submissionId);
  const progressResponse = waitForProgress(page);
  await page.getByRole('button', { name: '最新の進捗を取得' }).click();
  await progressResponse;
  await loadJudgeArtifacts(page);

  const banner = page.getByText('Judge Panel からの manual 判定');
  await expect(banner).toBeVisible();

  const presetButton = page.getByRole('button', { name: 'LLM設定をプリセット' }).first();
  await expect(presetButton).toBeVisible();
  await presetButton.click();

  const form = getRetryForm(page);
  await expect(form.provider).toHaveValue('openai');
  await expect(form.model).toHaveValue('gpt-4o-mini');
  await expect(form.temperature).toHaveValue('0.2');
  await expect(form.maxTokens).toHaveValue('1024');
});

test('manual card controls open artifacts and highlight card', async ({ page }) => {
  await page.goto('/');
  await page.fill('label:has-text("Submission ID") >> input', submissionId);
  const progressResponse = waitForProgress(page);
  await page.getByRole('button', { name: '最新の進捗を取得' }).click();
  await progressResponse;
  await loadJudgeArtifacts(page);

  const manualButton = page.getByRole('button', { name: /manual一覧へ移動/ });
  await expect(manualButton).toBeVisible();

  await page.getByRole('button', { name: '証拠ビューを開く' }).click();
  await expect(page.getByText('質問別LLM判定カード')).toBeVisible();
});
