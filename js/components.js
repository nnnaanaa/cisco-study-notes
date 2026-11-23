// HTML の資料で使う部品。資料の HTML に決まった class や data 属性を書くと、表示のときに動く部品になる。
// 書き方の一覧は README.md の「HTML の資料で使える部品」を参照。
(function () {
  "use strict";

  function esc(t) {
    return String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }
  async function copyText(text, btn, label) {
    try {
      await navigator.clipboard.writeText(text);
      btn.textContent = "コピーしました";
    } catch (_) {
      btn.textContent = "コピーできませんでした";
    }
    setTimeout(() => (btn.textContent = label), 1500);
  }

  // ---- 囲み: <div class="callout warning">…</div>（note / tip / important / warning / caution）
  const CALLOUT_TITLES = { note: "メモ", tip: "ポイント", important: "重要", warning: "注意", caution: "危険" };
  function callouts(root) {
    root.querySelectorAll("div.callout").forEach((box) => {
      if (box.querySelector(":scope > .callout-title")) return;
      const type = Object.keys(CALLOUT_TITLES).find((t) => box.classList.contains(t)) || "note";
      box.classList.add("callout-" + type);
      box.prepend(el("div", "callout-title", esc(box.dataset.title || CALLOUT_TITLES[type])));
    });
  }

  // ---- Cisco の設定: <pre data-cli="config"> の行末に「  ! 説明」を書くと、コマンドと説明を左右に並べる
  function cliConfig(root) {
    root.querySelectorAll('pre[data-cli="config"]').forEach((pre) => {
      const lines = pre.textContent.replace(/^\n/, "").replace(/\n\s*$/, "").split("\n");
      const rows = lines.map((line) => {
        const m = line.match(/^(.*\S)\s+!\s(.*)$/);
        return m ? { cmd: m[1], note: m[2] } : { cmd: line, note: "" };
      });
      const commands = rows.map((r) => r.cmd).join("\n") + "\n";
      const box = el("div", "cli-annot");
      if (pre.dataset.title) box.appendChild(el("div", "cli-annot-title", esc(pre.dataset.title)));
      rows.forEach((r) => {
        const cls = /^\s*!/.test(r.cmd) ? "sep" : /^\S/.test(r.cmd) ? "top" : "";
        const row = el("div", "cli-annot-row" + (r.note ? "" : " no-note"));
        row.appendChild(el("div", "cli-annot-cmd", '<span class="' + cls + '">' + esc(r.cmd) + "</span>"));
        row.appendChild(el("div", "cli-annot-note", esc(r.note)));
        box.appendChild(row);
      });
      const btn = el("button", "cli-copy", "コマンドだけをコピー");
      btn.type = "button";
      btn.addEventListener("click", () => copyText(commands, btn, "コマンドだけをコピー"));
      const wrap = el("div", "cli-annot-wrap");
      wrap.append(box, btn);
      pre.replaceWith(wrap);
    });
  }

  // ---- 機器の出力: <pre data-cli="show"> を端末風にする。中に <span class="hot" data-tip="説明"> を書ける
  function cliShow(root) {
    root.querySelectorAll('pre[data-cli="show"]').forEach((pre) => {
      pre.innerHTML = pre.innerHTML
        .replace(/^\n/, "")
        .replace(/^([A-Za-z0-9_-]+[#>])/gm, '<span class="term-prompt">$1</span>');
      const term = el("div", "term");
      if (pre.dataset.title) term.appendChild(el("div", "term-bar", "<span></span><span></span><span></span><b>" + esc(pre.dataset.title) + "</b>"));
      else term.appendChild(el("div", "term-bar", "<span></span><span></span><span></span>"));
      pre.removeAttribute("data-cli");
      pre.replaceWith(term);
      term.appendChild(pre);
      // 吹き出しの説明は紙に残らないので、印刷のときだけ出力の下に一覧で出す
      const hots = [...pre.querySelectorAll("[data-tip]")];
      if (hots.length) {
        const notes = el("div", "print-only tip-notes", "<b>出力の見かた</b>");
        const ul = el("ul");
        hots.forEach((h) => ul.appendChild(el("li", "", "<code>" + esc(h.textContent.trim()) + "</code>：" + esc(h.dataset.tip))));
        notes.appendChild(ul);
        term.after(notes);
      }
    });
  }

  // ---- 吹き出し: data-tip を持つ要素にポインタを当てる（スマホは押す）と説明が出る
  let tipEl = null;
  function ensureTip() {
    if (tipEl) return tipEl;
    tipEl = el("div", "doc-tip");
    document.body.appendChild(tipEl);
    addEventListener("scroll", () => tipEl.classList.remove("show"), { passive: true, capture: true });
    return tipEl;
  }
  function showTip(target) {
    const tip = ensureTip();
    tip.textContent = target.dataset.tip;
    tip.classList.add("show");
    const r = target.getBoundingClientRect();
    const w = tip.offsetWidth, h = tip.offsetHeight;
    const left = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), innerWidth - w - 8);
    let top = r.top - h - 8;
    if (top < 8) top = r.bottom + 8;
    tip.style.left = left + "px";
    tip.style.top = top + "px";
  }
  function tips(root) {
    root.querySelectorAll("[data-tip]").forEach((t) => {
      t.classList.add("hot");
      if (!t.hasAttribute("tabindex")) t.setAttribute("tabindex", "0");
      t.addEventListener("mouseenter", () => showTip(t));
      t.addEventListener("focus", () => showTip(t));
      t.addEventListener("click", () => showTip(t));
      t.addEventListener("mouseleave", () => ensureTip().classList.remove("show"));
      t.addEventListener("blur", () => ensureTip().classList.remove("show"));
    });
  }

  // ---- タブ: <div class="tabs"> の中に <div data-tab="名前">…</div> を並べる
  function tabs(root) {
    root.querySelectorAll("div.tabs").forEach((box) => {
      const panes = [...box.querySelectorAll(":scope > [data-tab]")];
      if (!panes.length) return;
      const bar = el("div", "tab-bar");
      bar.setAttribute("role", "tablist");
      panes.forEach((pane, i) => {
        const b = el("button", "", esc(pane.dataset.tab));
        b.type = "button";
        b.setAttribute("role", "tab");
        b.addEventListener("click", () => select(i));
        bar.appendChild(b);
        pane.classList.add("tab-pane");
        pane.prepend(el("div", "print-only tab-print-label", esc(pane.dataset.tab)));
      });
      box.prepend(bar);
      function select(i) {
        panes.forEach((p, k) => (p.hidden = k !== i));
        [...bar.children].forEach((b, k) => b.classList.toggle("on", k === i));
      }
      select(0);
    });
  }

  // ---- 組合せを試す表: <div class="combo" data-combo="etherchannel"></div>（etherchannel / dtp）
  const COMBOS = {
    etherchannel: {
      labels: ["SW1 のモード", "SW2 のモード"],
      modes: [
        { id: "on", proto: "手動" },
        { id: "desirable", proto: "PAgP" },
        { id: "auto", proto: "PAgP" },
        { id: "active", proto: "LACP" },
        { id: "passive", proto: "LACP" },
      ],
      start: ["active", "passive"],
      judge(a, b) {
        if (a.proto !== b.proto) {
          if (a.proto === "手動" || b.proto === "手動")
            return ["ng", "束ならない", "on は相手も on のときだけ束なる。on はネゴシエーションをしないので、PAgP・LACP とは話が通じない。"];
          return ["ng", "束ならない", "PAgP と LACP は別のプロトコルなので、混ぜると束ならない。"];
        }
        if (a.proto === "手動") return ["ok", "束なる", "両端とも on。ネゴシエーションせずに束ねる（設定の誤りに気付きにくい）。"];
        const lead = a.proto === "PAgP" ? "desirable" : "active";
        if (a.id !== lead && b.id !== lead)
          return ["ng", "束ならない", "どちらも「誘われ待ち」（" + a.id + "）なので、ネゴシエーションが始まらない。片方を " + lead + " にする。"];
        return ["ok", "束なる", a.proto + " で、" + lead + " の側からネゴシエーションを始めて束なる。"];
      },
      mark: { ok: "○", ng: "×" },
    },
    dtp: {
      labels: ["SW1 のモード", "SW2 のモード"],
      modes: [
        { id: "access", short: "access" },
        { id: "trunk", short: "trunk" },
        { id: "dynamic desirable", short: "desirable" },
        { id: "dynamic auto", short: "auto" },
      ],
      start: ["dynamic auto", "dynamic auto"],
      judge(a, b) {
        const ids = [a.id, b.id];
        const has = (m) => ids.includes(m);
        if (has("access") && has("trunk"))
          return ["ng", "不一致", "片方は常にアクセス、もう片方は常にトランク。どちらも相手に合わせないので、通信がうまくいかない。"];
        if (has("access")) return ["mid", "アクセス", "access の側がトランクを組まないので、アクセスポートとして動く。"];
        if (a.id === "dynamic auto" && b.id === "dynamic auto")
          return ["mid", "アクセス", "auto はどちらも「誘われたらトランクになる」だけで、自分からは誘わない。誰も誘わないのでトランクにならない。"];
        return ["ok", "トランク", has("trunk") ? "trunk の側が DTP で誘い、相手もトランクになる。" : "desirable の側が DTP で誘い、トランクになる。"];
      },
      mark: { ok: "トランク", mid: "アクセス", ng: "不一致" },
    },
  };
  function combos(root) {
    root.querySelectorAll("div.combo[data-combo]").forEach((box) => {
      const def = COMBOS[box.dataset.combo];
      if (!def || box.dataset.ready) return;
      box.dataset.ready = "1";
      const byId = Object.fromEntries(def.modes.map((m) => [m.id, m]));
      let sel = def.start.slice();
      const picker = el("div", "combo-picker");
      const segs = [0, 1].map((i) => {
        const col = el("div", "combo-col", "<label>" + esc(def.labels[i]) + "</label>");
        const seg = el("div", "combo-seg");
        def.modes.forEach((m) => {
          const b = el("button", "", esc(m.short || m.id));
          b.type = "button";
          b.title = m.proto || m.id;
          b.dataset.id = m.id;
          b.addEventListener("click", () => { sel[i] = m.id; render(); });
          seg.appendChild(b);
        });
        col.appendChild(seg);
        return col;
      });
      picker.append(segs[0], el("div", "combo-vs", "×"), segs[1]);
      const result = el("div", "combo-result", '<span class="combo-badge"></span><span class="combo-why"></span>');
      const table = el("table", "combo-matrix");
      let html = "<tr><th></th>" + def.modes.map((m) => "<th>" + esc(m.short || m.id) + "</th>").join("") + "</tr>";
      def.modes.forEach((r) => {
        html += "<tr><th>" + esc(r.short || r.id) + "</th>" + def.modes.map((c) => {
          const [kind] = def.judge(r, c);
          return '<td class="' + kind + '" data-a="' + esc(r.id) + '" data-b="' + esc(c.id) + '">' + esc(def.mark[kind]) + "</td>";
        }).join("") + "</tr>";
      });
      table.innerHTML = html;
      table.addEventListener("click", (e) => {
        const td = e.target.closest("td");
        if (!td) return;
        sel = [td.dataset.a, td.dataset.b];
        render();
      });
      box.append(picker, result, el("div", "combo-matrix-wrap"));
      box.lastChild.appendChild(table);
      function render() {
        segs.forEach((col, i) => col.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.id === sel[i])));
        const [kind, badge, why] = def.judge(byId[sel[0]], byId[sel[1]]);
        result.className = "combo-result " + kind;
        result.querySelector(".combo-badge").textContent = badge;
        result.querySelector(".combo-why").textContent = why;
        table.querySelectorAll("td").forEach((td) => td.classList.toggle("sel", td.dataset.a === sel[0] && td.dataset.b === sel[1]));
      }
      render();
    });
  }

  // ---- ブリッジ ID の計算: <div class="bid-calc"></div>
  function bidCalc(root) {
    root.querySelectorAll("div.bid-calc").forEach((box) => {
      if (box.dataset.ready) return;
      box.dataset.ready = "1";
      const opts = [];
      for (let p = 0; p <= 61440; p += 4096) opts.push('<option value="' + p + '"' + (p === 32768 ? " selected" : "") + ">" + p + "</option>");
      box.innerHTML =
        '<div class="bid-inputs"><label>優先度<select>' + opts.join("") + '</select></label>' +
        '<label>VLAN 番号<input type="number" min="1" max="4094" value="10"></label></div>' +
        '<div class="bid-out"><span class="bid-eq"></span><span class="bid-note"></span></div>';
      const sel = box.querySelector("select"), inp = box.querySelector("input");
      function render() {
        const p = Number(sel.value);
        const v = Math.min(4094, Math.max(1, Number(inp.value) || 1));
        box.querySelector(".bid-eq").innerHTML = p + " ＋ " + v + " ＝ <b>" + (p + v) + "</b>";
        box.querySelector(".bid-note").textContent =
          "show spanning-tree vlan " + v + " に表示される優先度。" + (p === 32768 ? "（既定値のまま）" : p <= 24576 ? "（root primary などで小さくした値）" : "");
      }
      sel.addEventListener("change", render);
      inp.addEventListener("input", render);
      render();
    });
  }

  // ---- めくれるカード: <div class="flashcards"><div class="fc"><div class="fc-q">問</div><div class="fc-a">答</div></div>…</div>
  function flashcards(root) {
    root.querySelectorAll("div.flashcards .fc").forEach((card) => {
      if (card.dataset.ready) return;
      card.dataset.ready = "1";
      const q = card.querySelector(".fc-q"), a = card.querySelector(".fc-a");
      if (!q || !a) return;
      const inner = el("div", "fc-inner");
      const front = el("div", "fc-face fc-front");
      front.append(q, el("span", "fc-hint", "押して答えを見る"));
      const back = el("div", "fc-face fc-back");
      back.append(a);
      inner.append(front, back);
      card.appendChild(inner);
      card.setAttribute("tabindex", "0");
      card.setAttribute("role", "button");
      const flip = () => card.classList.toggle("flip");
      card.addEventListener("click", flip);
      card.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); flip(); }
      });
    });
  }

  // 印刷のときは、閉じた切り分けを開き、すべてのタブを出し、カードを表に戻す（終わったら元に戻す）
  function beforePrint(root) {
    root.querySelectorAll("details.step:not([open])").forEach((d) => { d.open = true; d.dataset.printOpened = "1"; });
    root.querySelectorAll(".tab-pane[hidden]").forEach((p) => { p.hidden = false; p.dataset.printShown = "1"; });
    root.querySelectorAll(".fc.flip").forEach((c) => { c.classList.remove("flip"); c.dataset.printFlipped = "1"; });
  }
  function afterPrint(root) {
    root.querySelectorAll('[data-print-opened]').forEach((d) => { d.open = false; delete d.dataset.printOpened; });
    root.querySelectorAll('[data-print-shown]').forEach((p) => { p.hidden = true; delete p.dataset.printShown; });
    root.querySelectorAll('[data-print-flipped]').forEach((c) => { c.classList.add("flip"); delete c.dataset.printFlipped; });
  }

  window.DocComponents = {
    beforePrint,
    afterPrint,
    init(root) {
      // 演習（js/cli-lab.js）は中に囲みや注釈付きの設定を作るので、いちばん先に組み立てる
      if (window.DocCliLab) window.DocCliLab.init(root);
      callouts(root);
      cliConfig(root);
      cliShow(root);
      tabs(root);
      combos(root);
      bidCalc(root);
      flashcards(root);
      tips(root);
    },
  };
})();
