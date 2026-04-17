# 経費精算アプリ

現場でスマホからレシートを撮影して経費を申請するWebアプリです。  
**インストール不要・サーバー不要**でブラウザだけで動きます。

## ファイル構成

| ファイル | 対象 | 説明 |
|---|---|---|
| `index.html` | **社員** | レシート撮影・経費入力・JSON出力 |
| `admin.html` | **管理者** | JSON取込・JDL形式CSV出力 |

---

## 社員向け：使い方

1. **[→ アプリを開く](https://YOUR_GITHUB_USERNAME.github.io/YOUR_REPO_NAME/)** をスマホで開く
2. 画面右上「Gemini APIキー」をタップしてキーを入力（初回のみ）
3. レシートを撮影 → 日付・金額が自動入力される
4. 項目・店名・現場名を確認して「保存」
5. リストタブから「JSON出力」→ 管理者に送付

### Gemini APIキーの取得（無料・各自）

1. [Google AI Studio](https://aistudio.google.com/app/apikey) にアクセス
2. 「Create API key」をクリック
3. 生成されたキー（`AIzaSy...`）をアプリに貼り付け

> 無料枠：1日1,500リクエスト・毎分15回（通常の経費精算には十分です）

---

## 管理者向け：使い方

1. **[→ 管理者画面を開く](https://YOUR_GITHUB_USERNAME.github.io/YOUR_REPO_NAME/admin.html)** をPCで開く
2. 社員から送られたJSONファイルをドラッグ＆ドロップで取込
3. 内容を確認・金額を修正（必要に応じて）
4. 「JDL形式CSV出力」ボタンでCSVをダウンロード
5. JDL会計ソフトにCSVを取り込む

---

## GitHubへのアップ・公開手順

1. GitHub で **New repository** を作成（Public推奨）
2. `index.html`・`admin.html`・`README.md` をアップロード
3. `Settings` → `Pages` → **Branch: main / (root)** → Save
4. 数分後にURLが発行される
5. 社員用URL（`/`）と管理者用URL（`/admin.html`）を各自に共有

---

## データについて

- 入力データはスマホ・PC本体に保存されます（外部サーバーには送信されません）
- レシート画像の読み取りにのみ Gemini API を使用します
- APIキーは各自の端末にのみ保存されます
