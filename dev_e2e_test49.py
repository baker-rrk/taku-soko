# -*- coding: utf-8 -*-
"""
dev_e2e_test49.py — Playwright E2E テストスイート（現行UI・最新仕様対応版）
使い方: python dev_e2e_test49.py [対象ディレクトリ]
※本体コードは一切変更せず、現行UIのモーダル導線・カード詳細モーダル・各画面遷移を実走検証する。
"""
import os
import sys
import pathlib
from playwright.sync_api import sync_playwright


def run_e2e(target_dir: str) -> int:
    html_path = pathlib.Path(target_dir).resolve() / "index.html"
    if not html_path.exists():
        print(f"[ERROR] index.html が見つかりません: {html_path}")
        return 1

    file_url = html_path.as_uri()
    passed = 0
    failed = 0
    page_errors = []

    def check(name: str, fn):
        nonlocal passed, failed
        try:
            fn()
            passed += 1
            print(f"  [PASS] {name}")
        except Exception as e:
            failed += 1
            print(f"  [FAIL] {name} -> {e}")

    print(f"=== Playwright E2E テスト開始: {file_url} ===")
    with sync_playwright() as p:
        browser = None
        for launch_kwargs in (
            {"headless": True},
            {"channel": "msedge", "headless": True},
            {"channel": "chrome", "headless": True},
        ):
            try:
                browser = p.chromium.launch(**launch_kwargs)
                break
            except Exception:
                continue
        if browser is None:
            raise RuntimeError("Playwright 用の Chromium / Edge / Chrome ブラウザが見つかりません")
        context = browser.new_context(viewport={"width": 1440, "height": 900})
        page = context.new_page()
        page.on("pageerror", lambda err: page_errors.append(str(err)))

        # 1. 初期起動と appReady 待機
        def step_boot():
            page.goto(file_url, wait_until="domcontentloaded")
            page.wait_for_function("window.appReady !== undefined")
            page.evaluate("() => window.appReady")
            assert page.locator("#databaseTab.active").count() == 1, "初期表示が databaseTab でない"
            assert page.locator(".scenario-db-card").count() >= 1, "サンプルシナリオカードが表示されていない"
            schema_ver = page.evaluate("() => appState.schemaVersion")
            assert schema_ver == 3, f"appState.schemaVersion が 3 でない: {schema_ver}"
            cats = page.evaluate("() => appState.scenarios[0].imageCategories.join(',')")
            assert cats == "トレーラー,NPC,背景,前景,マップ,部屋素材", f"初期シナリオの6カテゴリが想定外: {cats}"

        check("1. 初期起動とホーム画面（databaseTab）・schemaVersion=3・6カテゴリ標準化の確認", step_boot)

        # 2. ホーム画面のシナリオカードクリック ➔ 📋 シナリオ詳細モーダル起動 ➔ 📝 Discord投稿・編集画面へ遷移
        def step_card_detail_modal():
            card = page.locator(".scenario-db-card").first
            # カード本体（ボタン以外）をクリックして「📋 シナリオ詳細モーダル」を起動
            card.locator(".scenario-card-thumb-wrap").click()
            modal = page.locator(".sd-overlay .sd-modal")
            modal.wait_for(state="visible", timeout=5000)
            head_text = modal.locator(".sd-head h2").inner_text()
            assert "シナリオ詳細" in head_text, f"詳細モーダル見出しが想定外: {head_text}"
            title_text = modal.locator(".sd-title").inner_text()
            assert "サンプルシナリオA" in title_text, f"詳細モーダル内タイトルが想定外: {title_text}"

            # 詳細モーダル内の「📝 Discord投稿・編集画面で開く」ボタンで postTab へ遷移
            modal.locator('[data-sd="edit"]').click()
            page.wait_for_selector(".sd-overlay", state="detached", timeout=5000)
            assert page.locator("#postTab.active").count() == 1, "詳細モーダルから postTab へ遷移していない"
            assert page.locator("#title").input_value() == "サンプルシナリオA", "シナリオタイトルがフォームに読み込まれていない"

        check("2. ホーム画面カードクリック ➔ 📋 シナリオ詳細モーダル表示 ➔ 編集画面遷移", step_card_detail_modal)

        # 3. ホーム画面のカード上クイック編集ボタン（📝 編集 [data-act="load"]）および複数選択チェックボックスの確認
        def step_card_quick_edit_btn():
            page.locator('.tab-btn[data-tab="databaseTab"]').click()
            page.wait_for_selector("#databaseTab.active", timeout=5000)
            # 複数選択チェックボックスと一括操作バーの確認
            chk = page.locator('.scenario-db-card .db-sel-chk').first
            chk.check()
            assert page.locator("#dbBulkBar").is_visible(), "複数選択バー（#dbBulkBar）が表示されていない"
            page.locator('[data-bulk-act="clear"]').click()
            assert not page.locator("#dbBulkBar").is_visible(), "選択解除で #dbBulkBar が非表示になっていない"

            quick_btn = page.locator('.scenario-db-card [data-act="load"]').first
            assert "編集" in quick_btn.inner_text() or "呼出" in quick_btn.inner_text()
            quick_btn.click()
            assert page.locator("#postTab.active").count() == 1, "クイック編集ボタンで postTab へ遷移していない"

        check("3. ホーム画面カードの複数選択・クイック編集ボタン（[data-act=\"load\"]）による直接遷移", step_card_quick_edit_btn)

        # 4. 現行UIの設定モーダル（#settingsOpenBtn / #settingsModal 2タブ構成・ベースタグ管理・テーマ切替）の開閉と操作
        def step_settings_modal():
            settings_btn = page.locator('#settingsOpenBtn, [data-on-click="open-settings-modal"]').first
            settings_btn.click()
            modal = page.locator("#settingsModal.open")
            modal.wait_for(state="visible", timeout=5000)

            # 2タブ構成の確認（外観・テーマ設定 / Discord投稿・初期設定）
            assert modal.locator('[data-set-tab="appearance"]').count() == 1, "外観・テーマタブが見つからない"
            assert modal.locator('[data-set-tab="discord"]').count() == 1, "Discord設定タブが見つからない"

            # 外観タブでダーク／ライト切替を確認
            modal.locator('[data-set-tab="appearance"]').click()
            initial_theme = page.evaluate("() => document.documentElement.dataset.theme")
            next_btn_theme = "light" if initial_theme == "dark" else "dark"
            modal.locator(f'[data-theme-set="{next_btn_theme}"]').click()
            next_theme = page.evaluate("() => document.documentElement.dataset.theme")
            assert initial_theme != next_theme, "テーマが切り替わっていない"

            # Discord投稿・初期設定タブへ切り替え、ベースタグ管理・Bot表示名・チャンネル追加を確認
            modal.locator('[data-set-tab="discord"]').click()
            assert modal.locator("#baseTagCard").is_visible(), "ベースタグ管理カード（#baseTagCard）が表示されていない"
            bot_input = modal.locator("#botName")
            bot_input.fill("E2EテストBot")
            before_ch = modal.locator("#channelConfigList .ch-acc").count()
            modal.locator('[data-on-click="addChannelConfig"]').click()
            after_ch = modal.locator("#channelConfigList .ch-acc").count()
            assert after_ch == before_ch + 1, "チャンネル設定が追加されていない"

            # 設定モーダルを閉じる
            modal.locator('.settings-head [data-on-click="close-settings-modal"]').click()
            assert page.locator("#settingsModal.open").count() == 0, "設定モーダルが閉じていない"
            assert page.locator("#pvUsername").inner_text() == "E2EテストBot", "Bot表示名がプレビューに反映されていない"

        check("4. 設定モーダル（#settingsModal 2タブ構成・ベースタグ管理・テーマ切替・Discord設定）", step_settings_modal)

        # 5. 現行UIの「📜 投稿履歴を見る」ボタン（モーダル操作 ➔ 全体履歴 historyTab への遷移）
        def step_history_modal():
            hist_btn = page.locator('[data-on-click="open-history-modal"]').first
            hist_btn.click()
            hist_modal = page.locator(".app-dialog.hist-modal")
            hist_modal.wait_for(state="visible", timeout=5000)
            assert "投稿履歴" in hist_modal.locator(".app-dialog-title").inner_text()

            # モーダル内の「すべての投稿履歴（全体）を開く」ボタンで historyTab へ遷移
            hist_modal.locator('[data-hall="1"]').click()
            page.wait_for_selector(".app-dialog.hist-modal", state="detached", timeout=5000)
            assert page.locator("#historyTab.active").count() == 1, "投稿履歴モーダルから historyTab へ遷移していない"

        check("5. 「📜 投稿履歴を見る」モーダル表示と全体履歴（historyTab）への遷移", step_history_modal)

        # 6. 秘匿HOタブの追加・編集とブロック操作、新規シナリオ追加モーダル、ギャラリー・ココフォリアタブ・テーマ切替
        def step_blocks_ho_and_tabs():
            page.locator('.tab-btn[data-tab="postTab"]').click()
            assert page.locator("#postTab.active").count() == 1

            # 秘匿HOタブ追加
            page.locator('#hoTabs [data-ho-act="add-ho"]').click()
            assert page.locator("#hoPanel").is_visible(), "HO追加後に #hoPanel が表示されていない"
            page.locator('#hoTabs [data-ho-act="tab"][data-hi="-1"]').click()
            assert page.locator("#postForm").is_visible(), "公開情報タブに戻れない"

            # 共通ギャラリータブ：フォルダ一覧 / 素材一覧 モード切替の確認
            page.locator('.tab-btn[data-tab="galleryTab"]').click()
            assert page.locator("#galleryTab.active").count() == 1
            page.locator('[data-gal="set-view"][data-gview="list"]').click()
            assert page.locator('[data-gal="set-view"][data-gview="list"].on').count() == 1, "共通ギャラリーが素材一覧モードに切り替わっていない"
            page.locator('[data-gal="set-view"][data-gview="folder"]').click()
            assert page.locator('[data-gal="set-view"][data-gview="folder"].on').count() == 1, "共通ギャラリーがフォルダ一覧モードに切り替わっていない"

            # ココフォリアタブ：右ペイン上部 .ccf-rtabs ピル型4タブ・[data-zoom] 拡大ボタン・部屋追加モーダルの確認
            page.locator('.tab-btn[data-tab="ccfTab"]').click()
            assert page.locator("#ccfTab.active").count() == 1
            for view_name in ("stocks", "npcs", "scene", "assets"):
                rtab = page.locator(f'.ccf-rtabs .ccf-rtab[data-view="{view_name}"]')
                assert rtab.count() == 1, f"ピル型タブ {view_name} が見つからない"
                rtab.click()
                assert page.locator(f'.ccf-rtabs .ccf-rtab.active[data-view="{view_name}"]').count() == 1, f"ピル型タブ {view_name} がアクティブにならない"
            page.locator('.ccf-rtabs .ccf-rtab[data-view="stocks"]').click()
            assert page.locator('.ccf-rtabs [data-zoom]').count() == 1, "拡大表示ボタン [data-zoom] が見つからない"

            # ココフォリアタブでの新規部屋追加（appPrompt 独自モーダルによる入力）
            page.locator("#ccfAddRoomBtn").click()
            prompt_ov = page.locator(".app-dialog-overlay")
            prompt_ov.wait_for(state="visible", timeout=5000)
            prompt_ov.locator(".app-prompt-input").fill("E2E追加部屋")
            prompt_ov.locator('[data-act="ok"]').click()
            page.wait_for_selector(".app-dialog-overlay", state="detached", timeout=5000)
            room_opt_text = page.locator("#ccfRoomSelect").inner_text()
            assert "E2E追加部屋" in room_opt_text, f"新規部屋が追加されていない: {room_opt_text}"

            # シナリオウィンドウ内でのプレビュー拡大中 Escape キー競合防止の検証
            page.locator('.tab-btn[data-tab="databaseTab"]').click()
            page.evaluate("() => openScenarioWindow(appState.scenarios[0].id, 'preview')")
            assert page.locator("#editScenarioModal").is_visible(), "シナリオウィンドウが開いていない"
            page.evaluate("() => togglePreviewZoom(true)")
            assert page.locator(".preview-area.zoomed").count() == 1, "プレビューが拡大されていない"
            page.keyboard.press("Escape")
            assert page.locator(".preview-area.zoomed").count() == 0, "1回目のEscapeでプレビュー拡大が解除されていない"
            assert page.locator("#editScenarioModal").is_visible(), "プレビュー拡大解除のEscapeでシナリオウィンドウまで閉じてしまっている"
            page.keyboard.press("Escape")
            assert not page.locator("#editScenarioModal").is_visible(), "2回目のEscapeでシナリオウィンドウが閉じていない"
            assert page.locator("#postTab .workspace .preview-area").count() == 1, "シナリオウィンドウ終了後に .preview-area が #postTab へ復元されていない"

        check("6. 秘匿HO・共通ギャラリー表示切替・ココフォリア4タブ/部屋追加・拡大プレビューEscape競合防止の確認", step_blocks_ho_and_tabs)

        # 7. ページエラー（未捕捉の ReferenceError / TypeError）が発生していないことの確認
        def step_no_page_errors():
            assert len(page_errors) == 0, f"未捕捉のページエラーが発生: {page_errors}"

        check("7. 実行中の未捕捉ランタイムエラー（pageerror）が0件であること", step_no_page_errors)

        browser.close()

    print(f"\n=== dev_e2e_test49.py 結果: {passed} passed, {failed} failed ===")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    target = sys.argv[1] if len(sys.argv) > 1 else os.path.dirname(os.path.abspath(__file__))
    sys.exit(run_e2e(target))
