# Cisco Study Notes

Cisco の資格（CCNP など）の勉強の資料を、ブラウザで読みやすく表示するための静的サイトです。今は **CCNP（ENCOR）** の資料を置いています。

- サイト: https://nnnaanaa.github.io/cisco-study-notes/
- シートの置き場所: [ccnp/](ccnp/)

## シートを追加するとき

1. `.html`（または `.md`）ファイルを置く（例: `ccnp/encor/02-l3.html`）
2. [docs.js](docs.js) の `DOC_FILES` に1行追加する

```js
doc("ccnp/encor/02-l3.html", "L3", "EIGRP・OSPF の Cisco での設定"),
```

- ビルドは不要。`main` に push すると GitHub Pages に反映される
- ローカルで確認するときは HTTP サーバ経由で開く（`python -m http.server` など。`file://` では読み込めない）

## HTML の資料の書き方

HTML の資料は、`<html>` や `<head>` を書かず、**本文だけ**を書く（先頭は `<h1>` のタイトル）。ビューアの中に読み込まれるので、ナビ・検索・目次・ダークモード・印刷はそのまま使える。`<h2>` と `<h3>` が目次になる。

決まった class や data 属性を書くと、表示のときに部品になる（[js/components.js](js/components.js)、[css/components.css](css/components.css)）。

| 部品 | 書き方 |
| --- | --- |
| 見出しの下のラベル | `<div class="chips"><span class="chip">802.1Q</span></div>` |
| 囲み | `<div class="callout warning"><p>…</p></div>`（`note` `tip` `important` `warning` `caution`） |
| 図 | `<figure class="fig"><svg>…</svg></figure>`。SVG の中で `sw`（スイッチ）`pc` `t`（文字）`s`（小さい文字）`fwd`（転送）`blk`（ブロック）`trunk` などの class が使える。2つ並べるときは `<div class="fig-row">` で囲む |
| 注釈付きの設定 | `<pre data-cli="config" data-title="SW1">` の中に、行の後ろに `  ! 説明` を書く。コマンドと説明が左右に並び、「コマンドだけをコピー」ボタンが付く |
| 機器の出力 | `<pre data-cli="show" data-title="show …">`。中の `<span data-tip="説明">…</span>` にポインタを当てると説明が出る |
| 吹き出し | どこでも `<span data-tip="説明">…</span>` |
| タブ | `<div class="tabs"><div data-tab="L2">…</div><div data-tab="L3">…</div></div>` |
| 組合せを試す表 | `<div class="combo" data-combo="etherchannel"></div>`（`etherchannel`・`dtp`） |
| ブリッジ ID の計算 | `<div class="bid-calc"></div>` |
| 切り分け | `<details class="step"><summary>症状</summary><dl><dt>見る</dt><dd>…</dd>…</dl></details>` |
| めくれるカード | `<div class="flashcards"><div class="fc"><div class="fc-q">問</div><div class="fc-a">答</div></div></div>` |
| 左右に並べる | `<div class="two">…</div>` |

Markdown の資料（`.md`）も今までどおり使える。
