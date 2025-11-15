## リポジトリ全体移行手順

1. **移行先で `agent-store` を取得する**  
   ```bash
   git remote add agent-store https://github.com/Naoya-Yasuda/agent-store.git
   git fetch agent-store
   ```
   *`remote` は他リポジトリへの参照。`fetch` で履歴とブランチ一覧をローカルに持ってきます。*

2. **履歴付きでブランチを統合する**  
   ```bash
   git checkout -b merge-agent-store
   git merge agent-store/main --allow-unrelated-histories
   ```
   *`merge` は新旧の履歴を結合。相手側のブランチ名に応じて `main` を書き換え、未接続履歴には `--allow-unrelated-histories` を付けます。*

3. **移行先の通常ブランチにマージ内容を持ち込む**  
   ```bash
   git checkout main
   git merge merge-agent-store
   ```
   *ここでコンフリクトが出たら `git status` で確認して解消し、必要なテスト（`npm run build` や `pytest` など）を実行して安全性を担保してください。*

4. **強制プッシュ（必要な場合）**  
   ```bash
   git push --force-with-lease origin main
   ```
   *`--force-with-lease` はリモートを上書きするが、他者の更新がないことを確認した上で使う安全策。キーワード `force push` は履歴を書き換えるので慎重に。*

5. **仲介エージェントと調整**  
   移行後は仲介エージェントにブランチ名・テスト結果を共有し、移行先のレビューや `agent-hub` 側での追加設定（ディレクトリ構成、環境変数など）を行ってください。
