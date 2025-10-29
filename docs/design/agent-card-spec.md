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
| `complianceNotes` | string | ガバナンスに関する注意書き（公開可の範囲で） |
| `lastReviewedAt` | datetime | 最終審査日 |
| `status` | enum | `draft` / `published` / `suspended` |

### 関連テーブル
- `AgentCardTranslation` (localeごとの文言セット)
- `AgentCardTag` (タグ正規化テーブル)

## 3. API 契約案
- **GET `/public/catalog`**: `AgentCard` をレスポンスに含め、`locale`指定で翻訳を切り替え。
- **GET `/public/catalog/{slug}`**: 詳細取得。`longDescription`、`capabilities`、`complianceNotes`を返却。
- **POST `/v1/agents/{agentId}/card`**: 開発者ポータルからの編集 (RBAC + 審査プロセス必要)。
- **PATCH `/v1/agents/{agentId}/card/{locale}`**: 翻訳更新。

## 4. ガバナンス連携
- `lastReviewedAt` と `status` は審査完了時にgovernance-hubから更新。
- `complianceNotes` は審査コメントから自動生成し、公開情報として精査の上掲載。

## 5. ストレージ
- RDB (PostgreSQL) テーブル案:
```
AgentCards(
  id UUID PK,
  agent_id UUID FK,
  default_locale TEXT,
  icon_url TEXT,
  banner_url TEXT,
  status TEXT,
  last_reviewed_at TIMESTAMP,
  pricing_type TEXT,
  pricing_details TEXT,
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
```

## 6. バリデーション
- `displayName`: 3〜80文字。
- `shortDescription`: 200文字以内、HTML不可。
- `longDescription`: Markdown (制限版) を許可、XSSフィルタ必須。
- `capabilities`/`useCases`: 各10件以内、各項目40文字まで。
- `iconUrl`/`bannerUrl`: HTTPS必須。

## 7. UI/UX 考慮
- カタログ表示では `displayName`, `shortDescription`, `capabilities` を表示。
- 詳細ビューで `longDescription`, `useCases`, `pricing`, `complianceNotes` を展開。
- 多言語切替時は fallback (デフォルトlocale) を利用。

## 8. TODO
- APIモデル/DTOの実装 (TypeScript/Go?)
- DBマイグレーション適用(`scripts/run_migrations.sh`)とCI連携
- Portal UIのデザインモック作成
- バリデーションライブラリの選定
- `api/routes/agentCards.ts` でExpressルートを実装 (認証/認可含む)
- CIで `schemas/agent-card.schema.json` を利用したJSON検証を追加
- Jest/pytest等でバリデーションのユニットテストを実装
- 永続化層(ORM/SQL)実装と in-memory からの置き換え
- カタログレスポンスのlocaleフィルタリングとfallback処理
