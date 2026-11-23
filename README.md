# Cisco Study Notes

Cisco の資格（CCNP など）の勉強の資料を、ブラウザで読みやすく表示するための静的サイトです。今は **CCNP（ENCOR）** の資料を置いています。

- サイト: https://nnnaanaa.github.io/cisco-study-notes/
- シートの置き場所: [ccnp/](ccnp/)

## シートを追加するとき

1. `.md` ファイルを好きな場所に置く（例: `ccnp/encor/01-l2.md`）
2. [docs.js](docs.js) の `DOC_FILES` に1行追加する

```js
window.DOC_FILES = [
  doc("ccnp/encor/00-overview.md", "ENCOR 全体像", "6分野の配点と、押さえておきたい技術"),
  doc("ccnp/encor/01-l2.md", "L2", "STP・EtherChannel の Cisco での設定"),
];
```

- ビルドは不要。`main` に push すると GitHub Pages に反映される
- 図は Mermaid で書ける（```mermaid のコードブロック）
- ローカルで確認するときは HTTP サーバ経由で開く（`python -m http.server` など。`file://` では読み込めない）

## 資料で使える書き方

普通の Markdown（表、コードブロック、Mermaid の図）に加えて、次の書き方が使える。

**注意・ポイントの囲み**（GitHub と同じ書き方。GitHub 上でも囲みで表示される）

```markdown
> [!TIP]
> auto ＋ auto は束ならない。

> [!WARNING]
> 1つでも違うと suspended になる。
```

種類は `NOTE`（メモ）、`TIP`（ポイント）、`IMPORTANT`（重要）、`WARNING`（注意）、`CAUTION`（危険）。

**Cisco の設定と、行ごとの説明**（言語名を `config` にする）

````markdown
```config
interface Port-channel1   ! 以後の設定はこちらに入れる
 switchport mode trunk    ! L2 のトランクとして束ねる
```
````

- 行の後ろの `  ! 説明` は、緑の説明として表示される（位置は自動でそろう）。コピーボタンでは説明を除いたコマンドだけがコピーされる
- 先頭に「設定」のラベルが付き、`interface` などの1段目のコマンドは色が付く

**設定と show の出力を左右に並べる**（`config` のすぐ後に `show` を書く）

````markdown
```config
interface range Gi1/0/1 - 2
 channel-group 1 mode active
```

```show
SW1# show etherchannel summary
```
````

- 画面の幅が狭いときは縦に並ぶ
