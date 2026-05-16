# 経費精算アプリ

現場でスマホからレシートを撮影して経費を申請するWebアプリです。  
インストール不要・サーバー不要。ブラウザだけで動きます。

---

## 公開URL

| 用途 | URL |
|---|---|
| 社員用アプリ | https://akirasp4-lgtm.github.io/keihi-ai/ |
| 社長用アプリ | https://akirasp4-lgtm.github.io/keihi-ai/president.html |
| 管理者用 | https://akirasp4-lgtm.github.io/keihi-ai/admin.html |

---

## ファイル一覧

```
経費生産/
│
├── index.html              ← 【社員用】レシート撮影・経費入力・送信
├── president.html          ← 【社長用】支払元/按分対応の経費入力
├── admin.html              ← 【管理者用】JSON取込・JDL形式CSV / Amex照合CSV出力
│
├── guide_staff.html        ← 【社員向け】使い方ガイド
├── guide_president.html    ← 【社長向け】使い方ガイド
├── guide_admin.html        ← 【管理者向け】使い方ガイド
│
├── urls.html               ← URLをコピーして共有するページ
├── manifest.json           ← PWA manifest
├── icons/                  ← PWAアイコン一式
│
└── README.md               ← このファイル
```

---

## 使い方（概要）

### 社員
1. アプリを開いて氏名を入力
2. レシートを撮影 → AIが自動入力（元請け/現場/工番も選択）
3. 内容確認して「保存して次へ」
4. 「📤 管理者に送信」でGoogleドライブに自動保存

### 社長
1. レシートを撮影 → AIが自動入力
2. 支払元（現金 / GRアメックス / GRHDアメックス）を選択
3. 必要に応じて6社で按分（%指定 or 金額指定）
4. 「📤 管理者に送信」でGoogleドライブに自動保存

### 管理者
1. Googleドライブから申請JSONをダウンロード
2. 管理者画面にドラッグ＆ドロップ（複数人分まとめてOK）
3. 内容確認・「✏️ 編集」で必要に応じて修正（金額/カテゴリ/按分など）
4. 「JDL形式CSV出力」でJDL会計ソフトに取り込む
5. 「Amex照合CSV出力」でアメックス明細との突合・按分集計

---

## 技術構成

| 役割 | サービス | 費用 |
|---|---|---|
| ホスティング | GitHub Pages | 無料 |
| OCRプロキシ | Cloudflare Workers（keihi-ocr） | 無料（10万req/日） |
| OCR AI | Groq API（Llama 4） | 無料（14,400req/日） |
| マスタ連携 | Google Apps Script（予定管理アプリ） | 無料 |
| データ保存 | ブラウザのlocalStorage / Google Drive | 無料 |

---

## 注意事項

- データは申請者のブラウザ内に保存され、送信時にGoogle Driveの「経費申請」フォルダへ自動アップロードされます
- ブラウザのデータを削除するとローカルのデータも消えるため、こまめに送信してください
- 管理者はCSV出力を月次などで定期的に行ってください
- 詳細な技術仕様・運用は [社内資料/Claude引き継ぎ.md](社内資料/Claude引き継ぎ.md) を参照
