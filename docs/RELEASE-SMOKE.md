# Release Smoke Checklist

この文書は、ローカルの自動Gateでは証明できないWriter／外部配信境界を、実機またはGitHub管理環境で確認するための記録票です。PlaywrightのPASSを実機PASSへ読み替えません。

## Current acceptance baseline

- Accepted main: `c1508cc2d3a8d36e19a0cdf51fd604cb4f5fdbfb`
- Phase 0 application and gate-race repairs: #5 / #6
- main Deploy run `36296810578`: SUCCESS
- Automated Reader / Shared / Writer / Mobile / Presentation gates: GREEN at the accepted main
- IME / Selection / Native Clipboard / Font / typography / geometry: AUDITED by `npm run audit:browser`; iOS-only behavior remains a non-blocking BOUNDARY
- Playwright WebKit iPhone emulation remains automated evidence only.

## Historical automated baseline

- 自動検証HEAD: `859f71e` (`fix: keep metadata projections out of writer edits`)
- Reader checkpoint: `stable` / `reader-v0.1.0` = `925cfc7`
- 自動Mobile: Chromium Pixel 5相当、Playwright WebKit iPhone 13相当
- 自動Gate結果: Reader / Shared / Writer Unit / Writer Beta / Writer Mobile / Writer Presentation / Reader Mobile は上記HEADでPASS

This historical section preserves the earlier Source-backed migration and dynamic Ruby regression evidence; it is not the current acceptance authority.

## Machine-verified vs. boundary

`npm run audit:browser`（[`QUALITY-GATES.md`](QUALITY-GATES.md#real-browser-audit)）が、以前はこの表で人手確認としていた項目のうち、ブラウザ実測で確立できるものを判定する。`AUDITED`は監査checkの結果で判定し、人の目視を完了条件にしない。`BOUNDARY`はCDP・DOM・Performance・Accessibility証跡では確立できない範囲であり、非blockingの残境界として記録する。

| 項目 | 状態 | 根拠 |
| --- | --- | --- |
| 初回Draft | AUTOMATED | Writer Beta Gate `writerViewState`（表示設定でdirtyにならない） |
| Ruby編集 | AUDITED + AUTOMATED | `writerRuby`、audit `ime.after-ruby` |
| Native Copy | AUDITED | audit `viewer.native-copy`（OS Clipboard読取でPortable Text）、`writer.native-copy` |
| Portable Paste | AUDITED | audit `writer.native-paste`（ネイティブPaste→Source→共通Parser） |
| Title / Body境界 | AUDITED + AUTOMATED | audit `writer.title-body-boundary`、`writerBoundary` |
| 日本語IME | AUDITED | audit `ime.*`（CDP IMEでTitle末尾・Ruby直後・Presentation直後・本文末尾、確定の一意性、scroll不動） |
| Nishiki-teki | AUDITED | audit `font.nishiki-availability`（選択可否＝実Fontの描画幅変化） |
| 縦書き反復記号 | AUDITED | audit `vertical.repeat-mark-advance`（2em advance・非重複） |
| 文字サイズ / Ruby比 | AUDITED | audit `typography.ruby-relative-size`（14 / 20 / 32px） |
| 360px geometry | AUDITED | audit `geometry.phone-360.*` |
| Chrome復帰 | AUTOMATED | Reader focus visibility gate、Reader Mobile Gate（tap復帰） |
| Full Source Mode | AUTOMATED | Writer Beta Gate `writer` / `writerSource` |
| iOS soft keyboard / Safariのcaret追跡 | BOUNDARY | CDPはChromiumのIME経路を駆動し、iOSキーボードは駆動しない |
| touch selection handle / iOS編集メニュー | BOUNDARY | touch UIはCDPで観測できない |
| Safari固有のWebKit差 | BOUNDARY | Playwright WebKit iPhone emulation（Writer Mobile Gate）を超える差 |
| スクリーンリーダー読み上げ | BOUNDARY | Accessibility treeは検証済み。読み上げは未検証 |

## 自動Gateの記録

現行 accepted main `c1508cc2d3a8d36e19a0cdf51fd604cb4f5fdbfb` では、main Deploy run `36296810578` が成功し、Reader / Shared / Writer Unit / Writer Beta（13 sub-gates）/ Writer Presentation / Writer Mobile（Chromium Pixel 5相当・WebKit iPhone 13相当）/ Reader Mobile がGREEN。これは iPhone Safari 本体、Native Clipboard、実IME、実機Font描画、GitHub Branch Ruleset の確認結果を含まない。

### Historical run context

`859f71e` では、Reader Unit / Shared Contract / Writer Unit / Writer Core・Document・Source・WYSIWYG・Composition・Ruby・Boundary・Tab・Storage / Writer Presentation / Writer Mobile（Chromium Pixel 5相当・WebKit iPhone 13相当）/ Reader Mobile / syntax check を再実行してPASS。これは旧検証記録であり、現行受入基準ではない。

## Nishiki-teki配信判断

公式配布ページはNishiki-tekiをTrueTypeフォントとして配布し、創作物等への利用を案内している。しかし、公式ページ上でReaderが直接参照できるHTTPS Web Font URL、Web Font形式、CORS応答は確認できない。

そのため現時点では、次を禁止する。

- 公式配布物を確認なしにRepositoryへ同梱する
- 第三者CDNのURLを公式配信経路として採用する
- TTFダウンロードURLをそのままCSS `@font-face`へ設定する

正式なWeb Font URL、配布許諾、CORS、MIME、キャッシュ方針が確認できた場合だけ、Registry Font定義として追加する。

## stable保護

現時点の観測では、ローカルGitだけからstableのGitHub保護状態は判定できません。未認証API確認ではbranch protectionの取得が401、rulesets一覧は空で返ったため、`stable`保護は未確認として扱います。

GitHub管理環境で、`stable`について次を設定・確認する。

- direct push禁止
- force push禁止
- branch deletion禁止
- 更新は明示的なrelease操作またはPull Request経由

設定後はGitHub Branch Ruleset画面または認証済みAPIで確認し、この表へ観測結果を追記する。ローカルworkflowのPASSやtag固定だけでは、branch protection PASSとは判定しない。
