# Discord フォーラム概要自動投稿ツール（Electron デスクトップ版）

## 起動のしかた
1. [Node.js](https://nodejs.org/) をインストールする
2. このフォルダで `npm install`（初回のみ。Electron が入ります）
3. `npm start` で起動

## ファイルの構成（同じフォルダに置く）
- `main.js` … Electron の本体（ウィンドウ幅1200px・`nodeIntegration: true`・`contextIsolation: false`）
- `package.json` … `"start": "electron ."`
- `index.html` / `discord_forum_app_test49.css` / `app_test49_00_electron.js` 〜 `app_test49_14_gallery.js` … 画面とロジック
- `_TRPG_Data/` … 起動時に自動で作られるデータ保存フォルダ（資料ファイルなど）。シナリオごとの資料は `_TRPG_Data/scenarios/<シナリオID>/` に保存されます

## Webブラウザで開いたとき
`index.html` を直接開いても動きます。その場合、PCのフォルダの一括登録・資料ファイルの保存と「開く」は使えません（画像ファイルのドラッグ＆ドロップ登録は使えます）。

## 開発用（配布不要）
- `dev_tests_test49.js` … `node dev_tests_test49.js .`
- `dev_e2e_test49.py` … `python dev_e2e_test49.py .`（Playwright が必要）
