# AgentCard 設計ドラフト (2025-10-29)

## 1. 目的
- エージェントカタログ表示や開発者ポータルで参照するメタ情報を、統一した `AgentCard` エンティティとして管理する。
- 多言語対応、タグ、アイコン、利用シナリオなどを含め、利用者がエージェントを比較しやすくする。
- 初期リリースは `ja-JP` をデフォルトとし、将来的に他言語を追加する。

## 2. データモデル
| フィールド | 型 | 説明 |
| --- | --- | --- |
| `id` | UUID | AgentCard固有ID (Agentと1:1) |
| `agentId` | UUID | 紐づく Agent のID |
| `locale` | string | `ja-JP`, `en-US` 等。複数レコードで多言語対応 |
| `displayName` | string | 表示名 |
| `shortDescription` | string | 簡易説明 (最大200文字) |
| `longDescription` | string | 詳細説明 (Markdown許可) |
| `capabilities` | string[] | 主要機能タグ（最大10） |
| `useCases` | string[] | 想定ユースケース |
| `iconUrl` | string | 画像URL (CDN配信) |
| `bannerUrl` | string | 任意のバナー画像 |
| `pricing` | object | 課金情報 `{ type: 'free' | 'subscription' | 'usage', details: string }` |
| `executionProfile` | enum | `self_hosted` / `store_hosted_candidate`。将来のストアホスティングを見据えて実行場所を明示 |
| `endpointRelayId` | string | ストア内A2Aリレー経由で実エンドポイントへ接続する際の内部ID |
| `providerRegistryIds` | string[] | 任意。通信事業者IDやFCC FRNなどの登録番号 |
| `complianceNotes` | string | ガバナンスに関する注意書き（公開可の範囲で） |
| `lastReviewedAt` | datetime | 最終審査日 |
| `status` | enum | `draft` / `published` / `suspended` |
| `statusReason` | string | 審査ステージごとの結果サマリ（内部向け） |

### 関連テーブル
- `AgentCardTranslation` (localeごとの文言セット)
- `AgentCardTag` (タグ正規化テーブル)
- `AgentEndpointAttestation` (エンドポイント実在性検証ログ)

### 2.1 エンドポイントスナップショット
- 提出時にエンドポイント(OpenAPI/manifest)を `EndpointSnapshot` として取得し、`AgentCard.endpointRelayId` に紐付けて保管する。
- 審査完了までは外部ユーザーにはスナップショット情報のみを提示し、実エンドポイントURLはストア側A2Aリレー経由のみに限定。
- Snapshotのハッシュが更新されたSubmissionのみ再審査を要求し、差分がない場合はカード更新のみで済ませる。

## 3. API 契約案
- **GET `/public/catalog`**: `AgentCard` をレスポンスに含め、`locale`指定で翻訳を切り替え。
- **GET `/public/catalog/{slug}`**: 詳細取得。`longDescription`、`capabilities`、`complianceNotes`を返却。
- **POST `/v1/agents/{agentId}/card`**: 開発者ポータルからの編集 (RBAC + 審査プロセス必要)。
- **PATCH `/v1/agents/{agentId}/card/{locale}`**: 翻訳更新。

## 4. ガバナンス連携
- `lastReviewedAt` と `status` は審査完了時にgovernance-hubから更新。
- `statusReason` にTemporalワークフローの各ステージ(Pre-check / Security / Functional / Judge / Human)の要約を記録し、内部監査用に保持。
- `complianceNotes` は審査コメントから自動生成し、公開情報として精査の上掲載。

## 5. ストア保持・審査ポリシー
- **複製保持**: 提出されたAgentCardはストアDBに複製し、審査完了までは利用者には`displayName`など最低限のメタ情報のみ表示。実エンドポイントとはストアA2Aリレーのみが通信する。
- **実在性確認**: `endpointRelayId` をキーにチャレンジレスポンス（Nonce + 署名 + RTT）を記録し、`AgentEndpointAttestation`へ保存。「本物のエージェント」かを検証する。
- **観点ベース質問生成**: Card `capabilities`/`useCases`/`complianceNotes` を入力に審査エージェントが質問テンプレートをリライト。AISIの既存質問は参照に留め、毎回カード差異をNLIで検証した上で投げる。
- **PI耐性 / 正常系 / 異常系**: AdvBench等の攻撃テンプレートをカード固有語彙で増幅しSandbox Runnerへ送付。カード記載のユースケースは正常シナリオとしてDSL化し、禁止行為は異常シナリオとして保持。両結果を差分表示。
- **再審査トリガー**: `executionProfile` または `providerRegistryIds` 変更時はPre-checkから再スタート、それ以外は差分に応じてステージスキップ可。

## 6. ストレージ
- RDB (PostgreSQL) テーブル案:
```
AgentCards(
  id UUID PK,
  agent_id UUID FK,
  default_locale TEXT,
  icon_url TEXT,
  banner_url TEXT,
  status TEXT,
  status_reason TEXT,
  last_reviewed_at TIMESTAMP,
  pricing_type TEXT,
  pricing_details TEXT,
  execution_profile TEXT,
  endpoint_relay_id TEXT,
  provider_registry_ids TEXT[],
  compliance_notes TEXT
)

AgentCardTranslations(
  card_id UUID FK,
  locale TEXT,
  display_name TEXT,
  short_description TEXT,
  long_description TEXT,
  capabilities TEXT[],
  use_cases TEXT[],
  PRIMARY KEY(card_id, locale)
)

AgentCardTags(
  card_id UUID FK,
  tag TEXT
)

AgentEndpointAttestations(
  id UUID PK,
  card_id UUID FK,
  endpoint_relay_id TEXT,
  challenge_nonce TEXT,
  response_signature TEXT,
  execution_fingerprint JSONB,
  round_trip_ms INTEGER,
  verified_at TIMESTAMP
)
```

## 7. バリデーション
- `displayName`: 3〜80文字。
- `shortDescription`: 200文字以内、HTML不可。
- `longDescription`: Markdown (制限版) を許可、XSSフィルタ必須。
- `capabilities`/`useCases`: 各10件以内、各項目40文字まで。
- `iconUrl`/`bannerUrl`: HTTPS必須。
- `executionProfile`: `self_hosted` or `store_hosted_candidate` のみ。
- `providerRegistryIds`: 文字列フォーマット(`^[A-Z0-9\\-]{4,32}$`)に一致するIDのみ受理。
- Snapshotハッシュ未更新で`longDescription`等一部フィールドだけ変化した場合は差分と紐付けて審査スキップ条件を判定。

## 8. UI/UX 考慮
- カタログ表示では `displayName`, `shortDescription`, `capabilities` を表示。
- 詳細ビューで `longDescription`, `useCases`, `pricing`, `complianceNotes` を展開。
- 多言語切替時は fallback (デフォルトlocale) を利用。
- 提出UIは「エンドポイントURL」「AgentCard JSONアップロード」「公開鍵」「事業者ID」の4フィールドを必須にし、登録後はステージ別ステータスバー(Pre-check / Security / Functional / Judge / Human)を表示。
- 審査結果画面はAgentCardフィールドとテストログ(質問・判定・根拠データセット)を横並びで表示し、差戻し対象フィールドをハイライト。

## 9. TODO
- APIモデル/DTOの実装 (TypeScript/Go?)
- DBマイグレーション適用(`scripts/run_migrations.sh`)とCI連携
- Portal UIのデザインモック作成
- バリデーションライブラリの選定
- `api/routes/agentCards.ts` でExpressルートを実装 (認証/認可含む)
- CIで `schemas/agent-card.schema.json` を利用したJSON検証を追加
- Jest/pytest等でバリデーションのユニットテストを実装
- 永続化層(ORM/SQL)実装と in-memory からの置き換え
- カタログレスポンスのlocaleフィルタリングとfallback処理
