# Review UI Playwright テスト指示書 (2025-11-12)

## 目的
- Human Review UI（Next.js）のクリティカルフロー（Judge manual判定、LLM override再実行、Ledger確認、Relay検索など）をブラウザ自動テストで担保する。
- CI で `npx playwright test` を実行し、`/review/progress` 等のRESTレスポンスをモックしても手動レビューに依存しないことを証明する。

## 前提
- Node.js 20系 / npm 10系。
- Review UI ルートで `npm install --save-dev @playwright/test msw` を追加し、`npx playwright install` でChromium等を取得。
- API呼び出しはMSW（Mock Service Worker）もしくは Playwright の `page.route` でスタブする。ここではMSW案を採用。

## ディレクトリ構成案
```
review-ui/
 ├─ tests/
 │   ├─ fixtures/
 │   │   ├─ progress-manual.json
 │   │   ├─ ledger-summary.json
 │   │   └─ events.json
 │   ├─ e2e/
 │   │   └─ judge-manual.spec.ts
 │   └─ support/
 │       └─ msw-handlers.ts
 └─ playwright.config.ts
```

## playwright.config.ts（抜粋）
```ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  retries: process.env.CI ? 2 : 0,
  use: {
    baseURL: 'http://localhost:3000',
    headless: true,
    viewport: { width: 1280, height: 720 },
    video: 'retain-on-failure'
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } }
  ]
});
```

## MSWハンドラ例
```ts
import { http, HttpResponse } from 'msw';
import progressManual from '../fixtures/progress-manual.json';
import ledgerSummary from '../fixtures/ledger-summary.json';
import stageEvents from '../fixtures/events.json';

export const handlers = [
  http.get('http://localhost:3000/review/progress/:submissionId', () => HttpResponse.json(progressManual)),
  http.get('http://localhost:3000/review/ledger/:submissionId', () => HttpResponse.json({ submissionId: 'demo', entries: ledgerSummary })),
  http.get('http://localhost:3000/review/events/:submissionId', () => HttpResponse.json({ submissionId: 'demo', events: stageEvents }))
];
```
Playwright の `test.beforeEach` で `page.addInitScript` を使い、`msw` をブラウザ側で起動する。

## シナリオ: judge-manual.spec.ts
1. `/`（Review Dashboard）を開く。
2. Submission ID に `demo-manual` を入力し「最新の進捗を取得」。mock progress がロードされる。
3. Manualバナーの「証拠ビューを開く」「該当カードへ移動」「LLM設定を見直して再実行」ボタンの挙動を検証。
4. Judgeカードが `manual` の場合にフォーカスハイライトが適用されることを確認。
5. LLM overrideフォームに manualカード由来のモデル名等がプリセットされる（将来のプリセット実装時は `expect(input).toHaveValue('gpt-4o')` などで検証）。
6. `Ledger 記録` セクションで `downloadAvailable: false` のカードが赤背景になり、詳細テキストが表示されるか確認。
7. Relayログ検索で `question-123` を入力し、結果一覧がフィルタされること。
8. 再実行フォームから `judge` ステージを選択し、`fetch('/review/retry')` モックが呼ばれることを `page.route` で検証。

## 実行方法
```bash
cd review-ui
npm install --save-dev @playwright/test msw
npx playwright install
npx playwright test tests/e2e/judge-manual.spec.ts
```

CI（GH Actions）では `review-ui/.github/workflows/review-ui-playwright.yml` を追加し、`npm ci -> npx playwright install --with-deps -> npx playwright test` を実行。MSWのfixtureが安定しているため、LLMやTemporalを起動せずにJudgeフローの回帰をカバーできる。
