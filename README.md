# Network Study Notes

ネットワークの勉強シートを、ブラウザで読みやすく表示するための静的サイトです。今は **CCNP（ENCOR）** の勉強シートを置いています。

- サイト: https://nnnaanaa.github.io/network-study-notes/
- シートの置き場所: [ccnp/](ccnp/)

## シートを追加するとき

1. `.md` ファイルを好きな場所に置く（例: `ccnp/encor/01-l2.md`）
2. [docs.js](docs.js) の `DOC_FILES` に1行追加する

```js
window.DOC_FILES = [
  doc("ccnp/encor/00-overview.md", "ENCOR 全体像", "6分野の配点とネスペとの重なり"),
  doc("ccnp/encor/01-l2.md", "L2", "STP・EtherChannel の Cisco での設定"),
];
```

- ビルドは不要。`main` に push すると GitHub Pages に反映される
- 図は Mermaid で書ける（```mermaid のコードブロック）
- ローカルで確認するときは HTTP サーバ経由で開く（`python -m http.server` など。`file://` では読み込めない）
