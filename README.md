# SchedSync 📅

全員のGoogleカレンダーの空き時間を自動算出するスケジュール調整アプリ

## セットアップ手順

### 1. リポジトリ名を確認・変更
`vite.config.js` の `base` をリポジトリ名に合わせてください：
```js
base: '/あなたのリポジトリ名/',
```
`index.html` 内の `/schedsync/` も同様に変更してください。

### 2. GitHub Pages の設定
1. GitHubリポジトリの **Settings → Pages**
2. Source を **GitHub Actions** に変更

### 3. mainブランチにpush
```bash
git add .
git commit -m "init"
git push origin main
```
→ 自動でビルド＆デプロイされます

### 4. URLにアクセス
`https://あなたのGitHubユーザー名.github.io/リポジトリ名/`

### 5. ホーム画面に追加（PWA）
- **iPhone**: Safariで開く → 共有ボタン →「ホーム画面に追加」
- **Android**: Chromeで開く → メニュー →「ホーム画面に追加」

## ローカル開発
```bash
npm install
npm run dev
```

## 注意
- アプリ内のストレージはClaude.aiの artifact storage を使用しています
- スタンドアロンのWebアプリとして動かす場合はFirebaseやSupabaseなどのバックエンドが必要です
