# Release Smoke Checklist

この文書は、ローカルの自動Gateでは証明できないWriter／外部配信境界を、実機またはGitHub管理環境で確認するための記録票です。PlaywrightのPASSを実機PASSへ読み替えません。

## 基準

- 自動検証HEAD: `3a3ab47` (`test: harden writer IME and Ruby copy boundaries`)
- Reader checkpoint: `stable` / `reader-v0.1.0` = `925cfc7`
- 自動Mobile: Chromium Pixel 5相当、Playwright WebKit iPhone 13相当
- 自動Gate結果: Reader / Shared / Writer Unit / Writer Mobile は上記HEADでPASS

## iPhone Safari実機

新しいSafari Private Browsingまたはサイトデータ消去後、公開Pagesで次を確認し、結果・iOS／Safari版本・公開URLを記録する。

| 項目 | 状態 | 確認内容 |
| --- | --- | --- |
| 初回Draft | UNVERIFIED | 初回Viewerで復元通知なし、表示設定変更でもdirtyにならない |
| Ruby編集 | UNVERIFIED | `｜読確認《よみかくにん》` の前後入力・削除・改行後もSourceを保持 |
| Native Copy | UNVERIFIED | Ruby全体を選択してSafariのコピーを実行し、外部メモへPortable Rubyとして貼付 |
| Portable Paste | AUTOMATED ONLY | アプリ内Pasteは自動Gateで確認済み。実機Clipboard権限は未確認 |
| Title / Body境界 | UNVERIFIED | Title末尾Enter、本文先頭Backspace、跨ぎ選択のSource保持 |
| 日本語IME | UNVERIFIED | Title／本文末尾、Ruby直後、Presentation直後の確定文字位置 |
| Nishiki-teki | UNVERIFIED | 未導入端末で実表示・`document.fonts`・Fallback／Warningを確認 |
| 縦書き反復記号 | UNVERIFIED | `前〳〵後`、`前〴〵後`をNishiki／Noto／fallbackで目視 |
| Chrome復帰 | AUTOMATED ONLY | tap復帰は自動Gate済み。Safariの実タップは未確認 |
| Full Source Mode | AUTOMATED ONLY | Container全体のparse→commit→再表示は自動Gate済み |

## Nishiki-teki配信判断

公式配布ページはNishiki-tekiをTrueTypeフォントとして配布し、創作物等への利用を案内している。しかし、公式ページ上でReaderが直接参照できるHTTPS Web Font URL、Web Font形式、CORS応答は確認できない。

そのため現時点では、次を禁止する。

- 公式配布物を確認なしにRepositoryへ同梱する
- 第三者CDNのURLを公式配信経路として採用する
- TTFダウンロードURLをそのままCSS `@font-face`へ設定する

正式なWeb Font URL、配布許諾、CORS、MIME、キャッシュ方針が確認できた場合だけ、Registry Font定義として追加する。

## stable保護

GitHub管理環境で、`stable`について次を設定・確認する。

- direct push禁止
- force push禁止
- branch deletion禁止
- 更新は明示的なrelease操作またはPull Request経由

設定後はGitHub Branch Ruleset画面または認証済みAPIで確認し、この表へ観測結果を追記する。ローカルworkflowのPASSやtag固定だけでは、branch protection PASSとは判定しない。

