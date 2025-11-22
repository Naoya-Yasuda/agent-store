export type StageName = 'precheck' | 'security' | 'functional' | 'judge' | 'human' | 'publish';

export const stageOrder: StageName[] = ['precheck', 'security', 'functional', 'judge', 'human', 'publish'];

export const stageLabels: Record<StageName, string> = {
  precheck: 'PreCheck',
  security: 'Security Gate',
  functional: 'Functional Accuracy',
  judge: 'Judge Panel',
  human: 'Human Review',
  publish: 'Publish'
};

export const stageIcons: Record<StageName, string> = {
  precheck: '🧾',
  security: '🛡️',
  functional: '🧪',
  judge: '⚖️',
  human: '🙋',
  publish: '🚀'
};

export type StageGuidance = {
  registrantFocus: string[];
  adminFocus: string[];
  artifactHighlights: string[];
};

export const stageGuidance: Record<StageName, StageGuidance> = {
  precheck: {
    registrantFocus: [
      '提出 ID / エージェント ID が期待どおりか、PreCheck summary 内の agentId・revision を確認してください。',
      'warnings が出ている場合はメッセージとカテゴリーを確認し、対応済みであることを記録します。'
    ],
    adminFocus: [
      'PreCheck summary 食い違い（summary.errors や warnings）があればリトライし、Ledger エントリを再送する。',
      '再提出が必要な場合は `precheck` stage から手動で再実行して `message` を更新する。'
    ],
    artifactHighlights: ['summary']
  },
  security: {
    registrantFocus: [
      'Security summary のカテゴリ別結果 (`summary.categories`) と一覧に出力された `prompts` を確認し、想定した攻撃観点が網羅されているかを検証。',
      'Relay などの `report`/`summary` で `needsReview` の有無と fail reasons を確認する。'
    ],
    adminFocus: [
      '実行時のプロンプト（prompts artifact）と security report を開き、禁止語検出や relay ログのエラーをチェック。',
      'Security ledger entry が送信済みか、必要なら `ledger/resend` エンドポイントで再送。'
    ],
    artifactHighlights: ['prompts', 'summary', 'report']
  },
  functional: {
    registrantFocus: [
      'Functional summary に記載された `passes` / `needsReview` を確認し、AdvBench を含むシナリオが期待どおりに取り込まれているか検証。',
      'Semantic 距離（averageDistance, embeddingAverageDistance）や RAGTruth 期待値との一致度をチェック。'
    ],
    adminFocus: [
      'Functional report を開いて topic/dialogue 指標や errors を確認し、不具合があったシナリオを Evidence として保存。',
      'AdvBench と AgentCard のシナリオ構成を確認し、summary で `advbenchScenarios` が 0 でないことを確認。'
    ],
    artifactHighlights: ['report', 'summary']
  },
  judge: {
    registrantFocus: [
      'Judge summary の Task Completion/Tool/Autonomy/Safety スコアと verdict を確認し、manual/reject の件数も把握する。',
      '少数派 veto や sensitive question について judge_report で各 LLM の rationale を確認。'
    ],
    adminFocus: [
      'Judge Report を開いて各質問の manual/reject/approve 判定や LLM call count を確認し、Relay ログのエラー・禁止語もクロスチェック。',
      'summary.llmJudge（provider/model/temperature）も照会し、LLM 設定を再現可能にして再実行用のパラメータを取得。'
    ],
    artifactHighlights: ['report', 'summary', 'relay']
  },
  human: {
    registrantFocus: [
      'Human Review の reason や notes を確認し、必要なら追加情報を提供して review UI から補足を送付。',
      'Human review が manual から approved/rejected に変わるまで待ち、final decision を記録。'
    ],
    adminFocus: [
      'Human decision を定期的に確認し、ログの `human` stage summary や attachments を保持。',
      '必要であれば manual decision の evidence を再取得しコメントを残す。'
    ],
    artifactHighlights: ['summary']
  },
  publish: {
    registrantFocus: [
      'Publish stage が完了しているかと、trustScore が target（例: auto decision 80 点以上）を満たしているかを確認。'
    ],
    adminFocus: [
      'Publish 時の ledger entry / metadata を確認し、ドメイン公開時の情報を保存。',
      '参考として `TrustScoreCard` に出る total score を記録。'
    ],
    artifactHighlights: ['summary']
  }
};
