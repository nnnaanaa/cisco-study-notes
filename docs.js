// ここに .md ファイルを追加すると、左のナビゲーションに表示されます。
// ビルドや GitHub への push は不要（このファイルを保存するだけで反映されます）。
//
// 書き方は2通り:
//   1. 文字列: このサイトと同じ場所に置いたローカルの .md ファイル
//        "ccnp/encor/00-overview.md"
//   2. オブジェクト { path, title, summary }: ナビに出す短い名前と一行説明を付けるとき
//        { path: "ccnp/encor/00-overview.md", title: "全体像", summary: "6分野と押さえたい技術" }
//
// 並び順はこのファイルに書いた順になる。先頭の資料がトップページになる。
const doc = (path, title, summary) => ({ path, title, summary });

// ナビゲーションに表示するフォルダ名（未指定のフォルダはそのままの名前で表示される）
window.DOC_FOLDER_LABELS = {
  ccnp: "CCNP",
  encor: "ENCOR",
};

window.DOC_FILES = [
  doc("ccnp/encor/00-overview.md", "ENCOR 全体像", "6分野の配点と、押さえておきたい技術"),
  doc("ccnp/encor/01-l2.html", "L2", "トランク・DTP、EtherChannel、Rapid PVST+・MST と保護機能"),
  doc("ccnp/encor/02-l3.html", "L3", "経路の選び方、OSPF、EIGRP との比較、eBGP"),
];
