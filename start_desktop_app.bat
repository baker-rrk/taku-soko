@echo off
chcp 65001 >nul
cd /d "%~dp0"
where npm >nul 2>&1
if errorlevel 1 (
  echo [エラー] npm (Node.js) が見つかりませんでした。Node.js をインストールしてから再実行してください。
  pause
  exit /b 1
)
echo 卓工房 デスクトップアプリ版を起動しています...
call npm start
if errorlevel 1 (
  echo.
  echo [エラー] アプリの起動に失敗しました。
  pause
)
