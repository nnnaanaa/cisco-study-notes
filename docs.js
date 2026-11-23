// ここに .md ファイルを追加すると、左のナビゲーションに表示されます。
// ビルドや GitHub への push は不要（このファイルを保存するだけで反映されます）。
//
// 書き方は2通り:
//   1. 文字列: このサイトと同じ場所に置いたローカルの .md ファイル
//        "ccnp/encor/00-overview.md"
//   2. オブジェクト { path, title, summary }: ナビに出す短い名前と一行説明を付けるとき
//        { path: "ccnp/encor/00-overview.md", title: "全体像", summary: "6分野とネスペとの重なり" }
//
// 並び順はこのファイルに書いた順になる。先頭の資料がトップページになる。
const doc = (path, title, summary) => ({ path, title, summary });

// ナビゲーションに表示するフォルダ名（未指定のフォルダはそのままの名前で表示される）
window.DOC_FOLDER_LABELS = {
  ccnp: "CCNP",
  encor: "ENCOR",
};

window.DOC_FILES = [
  doc("ccnp/encor/00-overview.md", "ENCOR 全体像", "6分野の配点とネスペとの重なり、新しく勉強する技術"),
];
