(() => {
  "use strict";

  // 記述の練習: 各資料の「| 問われ方 | 答えの型 |」の表を読み取り、
  // 問われ方を見て自分で答えを書き、答えの型と見比べて自己採点する。
  const STATS_KEY = "doc-writing-stats";
  const PREFS_KEY = "doc-writing-prefs";
  const HEADER_RE = /^\|\s*問われ方\s*\|\s*答えの型\s*\|\s*$/;
  const GRADES = [
    { key: "ok", label: "書けた", short: "書けた" },
    { key: "near", label: "惜しい", short: "惜しい" },
    { key: "ng", label: "書けなかった", short: "書けなかった" },
  ];

  function hashId(s) {
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = (h * 33 + s.charCodeAt(i)) >>> 0;
    return h.toString(36);
  }
  function loadJson(key) {
    try {
      return JSON.parse(localStorage.getItem(key) || "{}") || {};
    } catch {
      return {};
    }
  }
  function saveJson(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* 保存できない環境では記録が残らないだけ */
    }
  }
  function el(tag, className, text) {
    const e = document.createElement(tag);
    if (className) e.className = className;
    if (text != null) e.textContent = text;
    return e;
  }
  function button(text, className, onClick) {
    const b = el("button", className, text);
    b.type = "button";
    b.addEventListener("click", onClick);
    return b;
  }
  function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  const stats = loadJson(STATS_KEY);
  let ctx = null;
  let items = [];
  let session = null;
  let renderToken = 0;

  // ---- 表の読み取り ----
  function splitRow(line) {
    const PH = "\u0000";
    const cells = line.replace(/\\\|/g, PH).trim().replace(/^\|/, "").replace(/\|$/, "").split("|");
    return cells.map((c) => c.split(PH).join("|").trim());
  }
  function parseDoc(meta) {
    if (!meta.body) return [];
    const lines = meta.body.split(/\r?\n/);
    const out = [];
    for (let i = 0; i < lines.length; i++) {
      if (!HEADER_RE.test(lines[i])) continue;
      for (let j = i + 2; j < lines.length && lines[j].trim().startsWith("|"); j++) {
        const [q, a] = splitRow(lines[j]);
        if (!q || !a) continue;
        out.push({ id: hashId(meta.path + "\n" + q), doc: meta.path, q, a });
      }
    }
    return out;
  }
  async function loadItems(manifest) {
    await Promise.all(
      manifest.map(async (m) => {
        if (m.body || !m.dir) return;
        try {
          const res = await fetch(m.url || m.path, { cache: "no-cache" });
          if (res.ok) m.body = await res.text();
        } catch {
          /* 読めない資料は対象から外れるだけ */
        }
      })
    );
    return manifest.filter((m) => m.dir).flatMap(parseDoc);
  }

  // ---- 表示の補助 ----
  const docTitle = (path) => {
    const m = ctx.manifest.find((x) => x.path === path);
    return m ? m.title : path;
  };
  function renderInline(md) {
    const div = el("div", "kj-model-text");
    const html = window.marked ? marked.parseInline(md) : md;
    div.innerHTML = window.DOMPurify ? DOMPurify.sanitize(html) : html;
    if (window.fixCjkEmphasis) window.fixCjkEmphasis(div);
    return div;
  }
  const plain = (md) => md.replace(/\*\*|`/g, "");
  const norm = (s) =>
    s
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[\s、。，．,.「」『』（）()【】・:：;；!！?？"'”“’‘]/g, "");
  function keyPhrases(md) {
    const out = [];
    const re = /\*\*(.+?)\*\*/g;
    let m;
    while ((m = re.exec(md))) {
      const k = m[1].replace(/`/g, "").trim();
      if (k && !out.includes(k)) out.push(k);
    }
    return out;
  }
  const charCount = (s) => [...s.replace(/\s/g, "")].length;

  // ---- 記録と出題範囲 ----
  function grade(item) {
    const s = stats[item.id];
    return s ? s.r : null;
  }
  function inScope(scope) {
    switch (scope.type) {
      case "doc":
        return items.filter((it) => it.doc === scope.value);
      case "weak":
        return items.filter((it) => grade(it) && grade(it) !== "ok");
      case "unanswered":
        return items.filter((it) => !grade(it));
      default:
        return items.slice();
    }
  }
  function scopeLabel(scope) {
    if (scope.type === "doc") return docTitle(scope.value);
    if (scope.type === "weak") return "惜しい・書けなかった問題";
    if (scope.type === "unanswered") return "まだ書いていない問題";
    return "すべての問題";
  }
  const encodeScope = (s) => (s.type === "doc" ? "doc:" + s.value : s.type);
  const decodeScope = (v) => (v.startsWith("doc:") ? { type: "doc", value: v.slice(4) } : { type: v });

  // 書けなかった・惜しい・未挑戦・しばらく書いていない問題ほど出やすくする
  function weightOf(item) {
    const s = stats[item.id];
    if (!s) return 4;
    const days = (Date.now() - (s.t || 0)) / 86400000;
    const base = s.r === "ng" ? 6 : s.r === "near" ? 4 : 1;
    return base + Math.min(days, 7) / 2;
  }
  function pickWeighted(list, n) {
    const pool = list.map((it) => ({ it, w: weightOf(it) }));
    const out = [];
    while (out.length < n && pool.length) {
      const total = pool.reduce((a, p) => a + p.w, 0);
      let r = Math.random() * total;
      const idx = pool.findIndex((p) => (r -= p.w) <= 0);
      out.push(pool.splice(idx === -1 ? pool.length - 1 : idx, 1)[0].it);
    }
    return out;
  }

  // ---- 設定画面 ----
  function orderedDocs() {
    const withItems = new Set(items.map((it) => it.doc));
    return ctx.manifest.map((m) => m.path).filter((p) => withItems.has(p));
  }

  function renderSetup() {
    session = null;
    const c = ctx.container;
    c.innerHTML = "";
    c.append(el("div", "doc-breadcrumb", "記述の練習"));
    c.append(el("h1", null, "記述の練習"));
    c.append(
      el(
        "p",
        "doc-lead",
        "暗記シートの「答えの型」の表から出題します。問われ方を見て自分で答えを書き、答えの型と見比べて自己採点してください。"
      )
    );
    if (!items.length) {
      c.append(el("p", "empty", "答えの型の表が見つかりませんでした。"));
      return;
    }

    const counts = { ok: 0, near: 0, ng: 0 };
    items.forEach((it) => {
      const g = grade(it);
      if (g) counts[g]++;
    });
    const statsBox = el("div", "quiz-stats");
    [
      [items.length, "問題"],
      [counts.ok, "書けた"],
      [counts.near, "惜しい"],
      [counts.ng, "書けなかった"],
    ].forEach(([v, l]) => {
      const card = el("div", "quiz-stat");
      card.append(el("div", "quiz-stat-value", String(v)), el("div", "quiz-stat-label", l));
      statsBox.append(card);
    });
    c.append(statsBox);

    const prefs = loadJson(PREFS_KEY);
    const form = el("form", "quiz-setup");
    const scopeField = el("label", "quiz-field");
    scopeField.append(el("span", "quiz-field-label", "出題範囲"));
    const select = el("select", "quiz-select");
    const addOption = (parent, scope) => {
      const n = inScope(scope).length;
      if (!n) return;
      const o = el("option", null, scopeLabel(scope) + "（" + n + "問）");
      o.value = encodeScope(scope);
      parent.append(o);
    };
    addOption(select, { type: "all" });
    addOption(select, { type: "weak" });
    addOption(select, { type: "unanswered" });
    const docGroup = el("optgroup");
    docGroup.label = "資料";
    orderedDocs().forEach((p) => addOption(docGroup, { type: "doc", value: p }));
    select.append(docGroup);
    if (prefs.scope && [...select.options].some((o) => o.value === prefs.scope)) select.value = prefs.scope;
    scopeField.append(select);
    form.append(scopeField);

    const countField = el("div", "quiz-field");
    countField.append(el("span", "quiz-field-label", "問題数"));
    const seg = el("div", "quiz-segment");
    [
      ["5", "5問"],
      ["10", "10問"],
      ["0", "すべて"],
    ].forEach(([value, label]) => {
      const lab = el("label");
      const input = el("input");
      input.type = "radio";
      input.name = "kj-count";
      input.value = value;
      input.checked = String(prefs.count ?? "5") === value;
      lab.append(input, el("span", null, label));
      seg.append(lab);
    });
    countField.append(seg);
    form.append(countField);

    const start = el("button", "quiz-primary", "スタート");
    start.type = "submit";
    form.append(start);

    const prio = el("label", "quiz-check");
    const prioInput = el("input");
    prioInput.type = "checkbox";
    prioInput.checked = prefs.prioritize !== false;
    prio.append(prioInput, el("span", null, "苦手な問題を優先して出す（書けなかった・惜しい・まだ書いていない・しばらく書いていない問題が出やすくなります）"));
    form.append(prio);

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const count = Number(form.querySelector('input[name="kj-count"]:checked').value);
      saveJson(PREFS_KEY, { scope: select.value, count, prioritize: prioInput.checked });
      startSession(decodeScope(select.value), count, prioInput.checked);
    });
    c.append(form);

    c.append(el("h2", null, "資料ごとの記録"));
    const wrap = el("div", "table-wrap");
    const table = el("table", "quiz-progress-table");
    const thead = el("thead");
    const head = el("tr");
    ["資料", "書けた", "要復習", ""].forEach((h) => head.append(el("th", null, h)));
    thead.append(head);
    table.append(thead);
    const body = el("tbody");
    orderedDocs().forEach((path) => {
      const list = inScope({ type: "doc", value: path });
      const ok = list.filter((it) => grade(it) === "ok").length;
      const weak = list.filter((it) => grade(it) && grade(it) !== "ok").length;
      const row = el("tr");
      const titleCell = el("td");
      const a = el("a", null, docTitle(path));
      a.href = "#/" + path;
      titleCell.append(a);
      const okCell = el("td", null, ok + " / " + list.length);
      if (ok === list.length) okCell.classList.add("quiz-cell-done");
      const weakCell = el("td", null, weak ? String(weak) : "-");
      if (weak) weakCell.classList.add("quiz-cell-weak");
      const act = el("td");
      act.append(button("練習", "quiz-small", () => startSession({ type: "doc", value: path }, 0, false)));
      row.append(titleCell, okCell, weakCell, act);
      body.append(row);
    });
    table.append(body);
    wrap.append(table);
    c.append(wrap);

    c.append(
      button("記録をリセット", "quiz-link-button", () => {
        if (!confirm("このブラウザに記録された記述の練習の自己採点をすべて消去します。よろしいですか？")) return;
        Object.keys(stats).forEach((k) => delete stats[k]);
        saveJson(STATS_KEY, stats);
        renderSetup();
      })
    );
  }

  // ---- 出題 ----
  function startSession(scope, limit, prioritize, fixed) {
    let list = fixed || inScope(scope);
    if (!fixed && limit > 0 && list.length > limit) list = prioritize ? pickWeighted(list, limit) : shuffle(list).slice(0, limit);
    if (!list.length) return;
    session = { scope, limit, prioritize, index: 0, items: shuffle(list).map((it) => ({ it, text: "", revealed: false, result: null })) };
    renderCard();
  }

  function scrollTop() {
    const area = ctx.container.closest(".content-area");
    if (area) area.scrollTo({ top: 0 });
  }

  function renderCard() {
    const c = ctx.container;
    const cur = session.items[session.index];
    const total = session.items.length;
    c.innerHTML = "";

    const top = el("div", "quiz-top");
    top.append(el("span", "quiz-count", "問題 " + (session.index + 1) + " / " + total), el("span", "quiz-scope", scopeLabel(session.scope)));
    c.append(top);
    const bar = el("div", "quiz-bar");
    const fill = el("div", "quiz-bar-fill");
    fill.style.width = ((session.index / total) * 100).toFixed(1) + "%";
    bar.append(fill);
    c.append(bar);

    const card = el("div", "quiz-card");
    card.append(el("div", "quiz-source", docTitle(cur.it.doc)));
    const q = el("p", "quiz-question");
    q.append(renderInline(cur.it.q));
    card.append(q);

    const area = el("textarea", "kj-input");
    area.rows = 3;
    area.placeholder = "答えを書いてみる（理由なら「〜ため」「〜から」の形で、20〜40字が目安）";
    area.value = cur.text;
    const counter = el("div", "kj-count", charCount(cur.text) + " 字");
    area.addEventListener("input", () => {
      cur.text = area.value;
      counter.textContent = charCount(area.value) + " 字";
    });
    area.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        reveal();
      }
    });
    card.append(area, counter);

    const feedback = el("div", "kj-feedback");
    feedback.hidden = true;
    card.append(feedback);
    c.append(card);

    const actions = el("div", "quiz-actions");
    actions.append(button("中断して設定に戻る", "quiz-link-button", renderSetup));
    const show = button("答えを見る", "quiz-primary kj-reveal", reveal);
    actions.append(show);
    c.append(actions);
    c.append(el("p", "quiz-hint", "キーボード: Ctrl + Enter で答えを見る / 答えを見たあと 1・2・3 で自己採点、A で AI に確認"));

    scrollTop();
    if (cur.revealed) showFeedback();
    else area.focus({ preventScroll: true });
  }

  function reveal() {
    const cur = session.items[session.index];
    if (cur.revealed) return;
    cur.revealed = true;
    showFeedback();
  }

  function showFeedback() {
    const c = ctx.container;
    const cur = session.items[session.index];
    const area = c.querySelector(".kj-input");
    area.readOnly = true;
    const show = c.querySelector(".kj-reveal");
    if (show) show.remove();

    const fb = c.querySelector(".kj-feedback");
    fb.innerHTML = "";
    fb.append(el("div", "kj-label", "答えの型"));
    fb.append(renderInline(cur.it.a));

    const keys = keyPhrases(cur.it.a);
    if (keys.length) {
      const typed = norm(cur.text);
      const box = el("div", "kj-keys");
      box.append(el("span", "kj-keys-title", "太字の語句（目安）"));
      keys.forEach((k) => {
        const hit = typed && typed.includes(norm(k));
        const chip = el("span", "kj-key " + (hit ? "is-hit" : "is-miss"), (hit ? "✓ " : "✗ ") + plain(k));
        box.append(chip);
      });
      fb.append(box);
    }

    const peek = el("a", "kj-doc-link", "資料で確認する（新しいタブ）");
    peek.href = location.pathname + location.search + "#/" + cur.it.doc;
    peek.target = "_blank";
    peek.rel = "noopener";
    const links = el("div", "kj-links");
    links.append(peek, aiButton(cur));
    fb.append(links);

    const gradeRow = el("div", "kj-grades");
    gradeRow.append(el("span", "kj-grades-title", "自己採点"));
    GRADES.forEach((g, i) => {
      const b = button(i + 1 + " " + g.label, "kj-grade kj-grade-" + g.key + (cur.result === g.key ? " is-on" : ""), () => setGrade(g.key));
      gradeRow.append(b);
    });
    fb.append(gradeRow);
    fb.hidden = false;

    const areaEl = c.closest(".content-area");
    if (areaEl) {
      const overflow = gradeRow.getBoundingClientRect().bottom - areaEl.getBoundingClientRect().bottom + 24;
      if (overflow > 0) areaEl.scrollBy({ top: overflow, behavior: "smooth" });
    }
  }

  // ---- AI に確認（claude.ai に貼り付けて採点してもらう。API キー不要） ----
  const AI_URL = "https://claude.ai/new";
  function aiPrompt(cur) {
    return [
      "ネットワークスペシャリスト試験（午後）の記述問題の練習です。私の答えを採点してください。",
      "",
      "【資料】" + docTitle(cur.it.doc),
      "【問われ方】" + plain(cur.it.q),
      "【答えの型（模範）】" + plain(cur.it.a),
      "【私の答え】" + (cur.text.trim() || "（未記入）"),
      "",
      "次の形で、短く日本語で答えてください。",
      "1. 判定: 正解 / 部分点 / 不正解（言い回しが違っても、意味が同じなら正解）",
      "2. 理由: 答えの型と比べて、合っている点と足りない点",
      "3. 試験で点が取れる書き方の例（20〜40字）",
    ].join("\n");
  }
  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      const ta = el("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.append(ta);
      ta.select();
      let ok = false;
      try {
        ok = document.execCommand("copy");
      } catch {
        ok = false;
      }
      ta.remove();
      return ok;
    }
  }
  function aiButton(cur) {
    const wrap = el("span", "kj-ai");
    const b = button("AI に確認（claude.ai）", "quiz-small kj-ai-button", async () => {
      const text = aiPrompt(cur);
      const ok = await copyText(text);
      const w = window.open(AI_URL, "_blank");
      if (w) w.opener = null;
      note.textContent = ok
        ? "採点のお願いをコピーしました。開いた claude.ai に貼り付けて（Ctrl + V）送信してください。"
        : "コピーできませんでした。下の文を選んでコピーし、claude.ai に貼り付けてください。";
      if (!ok) {
        const pre = el("pre", "kj-ai-text", text);
        note.after(pre);
      }
      if (!w) {
        const a = el("a", null, "claude.ai を開く");
        a.href = AI_URL;
        a.target = "_blank";
        a.rel = "noopener";
        note.append(" ", a);
      }
      note.hidden = false;
    });
    b.title = "問われ方・答えの型・自分の答えをまとめた採点のお願いをコピーし、claude.ai を開きます（A）";
    const note = el("span", "kj-ai-note");
    note.hidden = true;
    wrap.append(b, note);
    return wrap;
  }

  function setGrade(key) {
    const cur = session.items[session.index];
    cur.result = key;
    const prev = stats[cur.it.id];
    stats[cur.it.id] = { r: key, t: Date.now(), n: ((prev && prev.n) || 0) + 1 };
    saveJson(STATS_KEY, stats);
    if (session.index < session.items.length - 1) {
      session.index++;
      renderCard();
    } else {
      renderResult();
    }
  }

  // ---- 結果 ----
  function renderResult() {
    const c = ctx.container;
    const done = session.items;
    const by = (k) => done.filter((d) => d.result === k);
    const review = done.filter((d) => d.result && d.result !== "ok");
    c.innerHTML = "";
    c.append(el("div", "doc-breadcrumb", "記述の練習 / " + scopeLabel(session.scope)));
    c.append(el("h1", null, "結果"));

    const box = el("div", "quiz-result");
    const big = el("div", "quiz-result-score");
    big.append(el("span", "quiz-result-num", String(by("ok").length)), el("span", "quiz-result-total", " / " + done.length + " 問 書けた"));
    box.append(big);
    box.append(el("div", "quiz-result-rate", "惜しい " + by("near").length + " 問・書けなかった " + by("ng").length + " 問"));
    c.append(box);

    const actions = el("div", "quiz-actions quiz-result-actions");
    const last = session;
    if (review.length) {
      actions.append(
        button("惜しい・書けなかった " + review.length + " 問をもう一度", "quiz-primary", () =>
          startSession(last.scope, 0, false, review.map((d) => d.it))
        )
      );
    }
    actions.append(button("同じ範囲でもう一度", "quiz-secondary", () => startSession(last.scope, last.limit, last.prioritize)));
    actions.append(button("設定に戻る", "quiz-link-button", renderSetup));
    c.append(actions);

    if (review.length) {
      c.append(el("h2", null, "見直す問題"));
      review.forEach((d) => {
        const r = el("div", "quiz-review");
        const tag = el("span", "kj-tag kj-tag-" + d.result, d.result === "ng" ? "書けなかった" : "惜しい");
        const head = el("div", "kj-review-head");
        head.append(tag, el("span", "quiz-source", docTitle(d.it.doc)));
        r.append(head);
        const q = el("p", "kj-review-q");
        q.append(renderInline(d.it.q));
        r.append(q);
        if (d.text.trim()) r.append(el("p", "kj-review-mine", "自分の答え: " + d.text.trim()));
        const a = el("div", "kj-review-a");
        a.append(el("span", "kj-label", "答えの型"), renderInline(d.it.a));
        r.append(a);
        c.append(r);
      });
    }
    scrollTop();
  }

  document.addEventListener("keydown", (e) => {
    if (!session || !ctx || !ctx.container.querySelector(".kj-grades")) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    if (t && t.closest && t.closest("input, select, textarea:not([readonly])")) return;
    if (e.key === "a" || e.key === "A") {
      const ai = ctx.container.querySelector(".kj-ai-button");
      if (ai) {
        e.preventDefault();
        ai.click();
      }
      return;
    }
    const i = ["1", "2", "3"].indexOf(e.key);
    if (i !== -1) {
      e.preventDefault();
      setGrade(GRADES[i].key);
    }
  });

  async function render(container, { manifest, folderLabel }) {
    ctx = { container, manifest, folderLabel };
    session = null;
    const token = ++renderToken;
    container.innerHTML = "";
    container.append(el("p", "loading", "答えの型を読み込み中…"));
    items = await loadItems(manifest);
    // 読み込み中に別の画面へ移ったら描画しない
    if (token !== renderToken || !location.hash.startsWith("#/kijutsu")) return;
    renderSetup();
  }

  window.DocWriting = { render };
})();
