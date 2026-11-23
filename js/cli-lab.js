// コマンドを打って試す演習（<div class="cli-lab" data-lab="trunk"></div>）。
// 本物の IOS ではなく、演習で使うコマンドだけを解釈する小さなシミュレータ。
// 演習の中身（課題・最初の状態・相手の機器・答え合わせ）は、下の LABS に書く。
(function () {
  "use strict";

  const PORTS = 24;
  const VLAN_MAX = 4094;

  function esc(t) {
    return String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }
  const pad = (s, n) => String(s).padEnd(n);

  // ---------------------------------------------------------------- インタフェース名
  // 内部では "Gi1/0/5"・"Gi0/0"・"Lo0"・"Po1" で持つ
  let curSt = null; // いま入力を解釈している機器（GigabitEthernet が実在するかを確かめるのに使う）
  const IF_TYPES = [
    { full: "gigabitethernet", key: "Gi", long: "GigabitEthernet", min: 1, re: /^\d+\/\d+(\/\d+)?$/ },
    { full: "loopback", key: "Lo", long: "Loopback", min: 1, re: /^\d+$/, create: true },
    { full: "port-channel", key: "Po", long: "Port-channel", min: 2, re: /^\d+$/, create: true },
  ];
  function ifType(word) {
    const t = word.toLowerCase();
    return IF_TYPES.find((x) => t.length >= x.min && x.full.startsWith(t));
  }
  function parseIf(text) {
    const m = String(text).replace(/\s+/g, "").match(/^([a-z-]+?)(\d[\d/]*)$/i);
    if (!m) return null;
    const T = ifType(m[1]);
    if (!T || !T.re.test(m[2])) return null;
    const num = m[2].split("/").map(Number).join("/");
    if (T.key === "Po" && (+num < 1 || +num > 128)) return null;
    const k = T.key + num;
    if (!T.create && curSt && !curSt.ifs[k]) return null;
    return k;
  }
  const longIf = (k) => IF_TYPES.find((x) => k.startsWith(x.key)).long + k.slice(2);
  const ifNum = (k) => +k.split("/").pop().replace(/\D/g, "");
  function ifCmp(order) {
    return (a, b) => {
      const ta = order.indexOf(a.slice(0, 2)), tb = order.indexOf(b.slice(0, 2));
      if (ta !== tb) return ta - tb;
      const na = a.slice(2).split("/").map(Number), nb = b.slice(2).split("/").map(Number);
      for (let i = 0; i < Math.max(na.length, nb.length); i++) if ((na[i] || 0) !== (nb[i] || 0)) return (na[i] || 0) - (nb[i] || 0);
      return 0;
    };
  }
  const ifSort = ifCmp(["Po", "Gi", "Lo"]);
  const ifSortRun = ifCmp(["Lo", "Po", "Gi"]); // ルータの show running-config の順
  const ifSortBrief = ifCmp(["Gi", "Po", "Lo"]); // show ip interface brief の順
  const isIfTypePrefix = (w) => !!ifType(w);

  // "Gi1/0/1 - 2, Gi1/0/5" のような範囲
  function parseRange(text) {
    const out = [];
    for (const part of text.split(",")) {
      const m = part.trim().match(/^(.*?)(\d+)\s*(?:-\s*(\d+))?$/);
      if (!m) return null;
      const first = parseIf(m[1] + m[2]);
      if (!first) return null;
      const last = m[3] ? +m[3] : +m[2];
      if (last < +m[2]) return null;
      for (let n = +m[2]; n <= last; n++) {
        const k = parseIf(m[1] + n);
        if (!k) return null;
        out.push(k);
      }
    }
    return out.length ? out : null;
  }

  // ---------------------------------------------------------------- VLAN の一覧
  function parseVlans(text) {
    if (!/^\d+(-\d+)?(,\d+(-\d+)?)*$/.test(text)) return null;
    const out = new Set();
    for (const part of text.split(",")) {
      const [a, b] = part.split("-").map(Number);
      const end = b == null ? a : b;
      if (a < 1 || end > VLAN_MAX || end < a) return null;
      for (let v = a; v <= end; v++) out.add(v);
    }
    return [...out].sort((x, y) => x - y);
  }
  function fmtVlans(list) {
    if (list == null) return "1-4094";
    if (!list.length) return "none";
    const s = [...list].sort((a, b) => a - b), parts = [];
    for (let i = 0; i < s.length; i++) {
      let j = i;
      while (j + 1 < s.length && s[j + 1] === s[j] + 1) j++;
      parts.push(j > i ? s[i] + "-" + s[j] : String(s[i]));
      i = j;
    }
    return parts.join(",");
  }
  const vlanName = (v) => "VLAN" + String(v).padStart(4, "0");

  // ---------------------------------------------------------------- 文法
  const ARGS = {
    vlan: { help: "<1-4094>", desc: "VLAN 番号", parse: (t) => (/^\d+$/.test(t) && +t >= 1 && +t <= VLAN_MAX ? +t : null) },
    vlans: { help: "WORD", desc: "VLAN の一覧（例: 10,20,30-32）", parse: parseVlans },
    if: { help: "<interface>", desc: "インタフェース（例: GigabitEthernet0/0、Loopback0、Port-channel1）", parse: parseIf },
    range: { help: "<range>", desc: "例: GigabitEthernet1/0/1 - 2", rest: true, parse: parseRange },
    word: { help: "WORD", desc: "名前", parse: (t) => (/^[\w.-]{1,32}$/.test(t) ? t : null) },
    line: { help: "LINE", desc: "説明の文字列", rest: true, parse: (t) => t },
    grp: { help: "<1-128>", desc: "チャネルグループの番号", parse: (t) => (/^\d+$/.test(t) && +t >= 1 && +t <= 128 ? +t : null) },
    prio: { help: "<0-61440>", desc: "ブリッジの優先度（4096 の倍数）", parse: (t) => (/^\d+$/.test(t) && +t <= 61440 ? +t : null) },
    ip: { help: "A.B.C.D", desc: "IP アドレス", parse: (t) => parseIp(t) },
    mask: { help: "A.B.C.D", desc: "サブネットマスク", parse: (t) => parseIp(t) },
    wild: { help: "A.B.C.D", desc: "ワイルドカードマスク（0 のビットを比べる）", parse: (t) => parseIp(t) },
    area: { help: "<0-4294967295>", desc: "エリア番号（A.B.C.D の形でもよい）", parse: (t) => (/^\d+$/.test(t) && +t <= 4294967295 ? String(+t) : parseIp(t)) },
    pid: { help: "<1-65535>", desc: "プロセス ID（このルータの中だけの番号）", parse: (t) => numIn(t, 1, 65535) },
    asn: { help: "<1-4294967295>", desc: "AS 番号", parse: (t) => numIn(t, 1, 4294967295) },
    cost: { help: "<1-65535>", desc: "コスト", parse: (t) => numIn(t, 1, 65535) },
    oprio: { help: "<0-255>", desc: "優先度（0 は DR・BDR にならない）", parse: (t) => numIn(t, 0, 255) },
    secs: { help: "<1-65535>", desc: "秒", parse: (t) => numIn(t, 1, 65535) },
    refbw: { help: "<1-4294967>", desc: "基準の帯域幅（Mbps）", parse: (t) => numIn(t, 1, 4294967) },
  };
  function numIn(t, lo, hi) {
    return /^\d+$/.test(t) && +t >= lo && +t <= hi ? +t : null;
  }

  const KW = {
    enable: "特権 EXEC モードに入る", disable: "ユーザ EXEC モードに戻る", exit: "1つ上のモードに戻る", end: "特権 EXEC モードに戻る",
    configure: "設定モードに入る", terminal: "端末から設定する", show: "状態を表示する", do: "設定モードから EXEC のコマンドを実行する",
    write: "設定を保存する", memory: "NVRAM に保存する", copy: "設定をコピーする", "running-config": "いま動いている設定",
    "startup-config": "起動時に読む設定", interfaces: "インタフェースの状態", interface: "インタフェースを選ぶ", range: "複数のインタフェースをまとめて選ぶ",
    trunk: "トランク", switchport: "スイッチのポートの設定", vlan: "VLAN", brief: "一覧で表示", etherchannel: "EtherChannel の状態",
    summary: "要約を表示", "spanning-tree": "STP", hostname: "機器の名前を付ける", name: "VLAN の名前", no: "設定を取り消す",
    mode: "モード", access: "アクセスポート", dynamic: "DTP で相手と決める", auto: "相手に誘われたらトランクになる",
    desirable: "自分からトランクに誘う", encapsulation: "トランクのカプセル化", dot1q: "IEEE 802.1Q", negotiate: "相手と決める",
    native: "ネイティブ VLAN", allowed: "トランクで運ぶ VLAN", add: "一覧に足す", remove: "一覧から外す", except: "指定した VLAN 以外",
    all: "すべての VLAN", none: "どの VLAN も運ばない", nonegotiate: "DTP を止める", "channel-group": "EtherChannel に入れる",
    active: "LACP で自分から誘う", passive: "LACP で誘われたら応じる", on: "ネゴシエーションせずに束ねる", shutdown: "ポートを止める",
    description: "説明を付ける", portfast: "すぐ転送を始める（PC 向け）", bpduguard: "BPDU を受けたら止める", priority: "優先度",
    root: "ルートブリッジにする", primary: "ルートにする（24576）", secondary: "予備のルートにする（28672）",
    pvst: "PVST+", "rapid-pvst": "Rapid PVST+", mst: "MST",
    ip: "IP の設定・状態", address: "IP アドレス", ospf: "OSPF", bgp: "BGP", route: "ルーティングテーブル", protocols: "ルーティングプロトコルの状態",
    neighbor: "ネイバー（隣のルータ）", area: "エリア", network: "経路として扱うネットワーク", "router-id": "ルータ ID", router: "ルーティングプロトコルを動かす",
    "passive-interface": "hello を送らない（ネイバーを作らない）", default: "すべてのインタフェース", "auto-cost": "コストの計算方法",
    "reference-bandwidth": "コストの基準の帯域幅", cost: "コスト", "hello-interval": "hello の間隔", "dead-interval": "ダウンと判断するまでの時間",
    "point-to-point": "1対1（DR・BDR を選ばない）", broadcast: "ブロードキャスト（DR・BDR を選ぶ）", "remote-as": "相手の AS 番号", mask: "サブネットマスク",
    clear: "リセットする", process: "プロセス", ping: "疎通を確かめる", connected: "直結の経路",
  };
  // EtherChannel の desirable / auto は PAgP の意味になる
  const KW_CHANNEL = { desirable: "PAgP で自分から誘う", auto: "PAgP で誘われたら応じる", on: "ネゴシエーションせずに束ねる" };

  // "switchport mode (access|trunk)" のような書き方を、1本ずつの並びに展開する
  function expand(spec) {
    const m = spec.match(/\(([^()]*)\)/);
    if (!m) return [spec];
    return m[1].split("|").flatMap((alt) => expand(spec.replace(m[0], alt)));
  }
  const SW_ONLY = /^(no )?(switchport|channel-group|spanning-tree|vlan|name)\b|^show (interfaces trunk|interfaces <if> switchport|vlan|etherchannel|spanning-tree)/;
  function compile(defs, dev) {
    const out = {};
    defs.forEach(([modes, spec, run, only]) => {
      const d = only || (SW_ONLY.test(spec) || modes === "vlan" ? "sw" : null);
      if (d && d !== dev) return;
      expand(spec).forEach((s) => {
        const toks = s.split(" ").map((w) => (w[0] === "<" ? { arg: w.slice(1, -1) } : { kw: w }));
        modes.split(" ").forEach((m) => (out[m] = out[m] || []).push({ toks, run, ctx: s }));
      });
    });
    return out;
  }

  function tokenize(line) {
    const toks = [];
    const re = /\S+/g;
    let m;
    while ((m = re.exec(line))) toks.push({ t: m[0], off: m.index });
    // "int g 1/0/1" のように種類と番号の間に空白があるときは、1つにまとめる
    for (let i = 0; i + 1 < toks.length; i++) {
      if (/^[a-z-]+$/i.test(toks[i].t) && isIfTypePrefix(toks[i].t) && /^\d/.test(toks[i + 1].t)) {
        toks[i].t += toks[i + 1].t;
        toks.splice(i + 1, 1);
      }
    }
    return toks;
  }

  // 入力の単語を順に当てはめ、まだ候補に残っている並びを返す
  function walk(tokens, cmds) {
    let alive = cmds.map((c) => ({ c, k: 0, args: [], done: false }));
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i].t, tl = t.toLowerCase();
      const live = alive.filter((e) => !e.done && e.k < e.c.toks.length);
      const kws = new Set();
      let exact = false;
      live.forEach((e) => {
        const pt = e.c.toks[e.k];
        if (pt.kw && pt.kw.startsWith(tl)) { kws.add(pt.kw); if (pt.kw === tl) exact = true; }
      });
      if (!exact && kws.size > 1) return { error: "ambiguous", at: i };
      const next = [];
      live.forEach((e) => {
        const pt = e.c.toks[e.k];
        if (pt.kw) {
          if (exact ? pt.kw === tl : pt.kw.startsWith(tl)) next.push({ ...e, k: e.k + 1 });
          return;
        }
        const A = ARGS[pt.arg];
        if (A.rest) {
          const v = A.parse(tokens.slice(i).map((x) => x.t).join(" "));
          if (v != null) next.push({ ...e, k: e.k + 1, args: [...e.args, v], done: true });
        } else {
          const v = A.parse(t);
          if (v != null) next.push({ ...e, k: e.k + 1, args: [...e.args, v] });
        }
      });
      if (!next.length) return { error: "invalid", at: i };
      const finished = next.filter((e) => e.done);
      if (finished.length) return { alive: finished, consumedAll: true };
      alive = next;
    }
    return { alive };
  }
  function matchCmd(tokens, cmds) {
    const w = walk(tokens, cmds);
    if (w.error) return w;
    const full = w.alive.filter((e) => e.k === e.c.toks.length);
    if (full.length) return { ok: true, cmd: full[0].c, args: full[0].args };
    return { error: "incomplete" };
  }

  // ---------------------------------------------------------------- スイッチの状態
  function newIf() {
    return { mode: null, access: 1, native: 1, allowed: null, nonego: false, encap: null, group: null, gmode: null, shut: false, desc: "", portfast: false, bpduguard: false,
      ip: null, ospfPid: null, ospfArea: null, ospfCost: null, ospfPrio: null, ospfNet: null, hello: null, dead: null };
  }
  const L2KEYS = ["mode", "access", "native", "allowed", "nonego", "encap"];
  function copyL2(from, to) {
    L2KEYS.forEach((k) => (to[k] = Array.isArray(from[k]) ? [...from[k]] : from[k]));
  }
  function sameL2(a, b) {
    return L2KEYS.every((k) => JSON.stringify(a[k]) === JSON.stringify(b[k]));
  }

  function newState(lab) {
    const router = lab.device === "router";
    const st = {
      dev: router ? "rt" : "sw",
      host: lab.host || (router ? "R1" : "SW1"),
      mode: "user",
      ctx: null,
      vlans: new Map([[1, "default"]]),
      ifs: {},
      stp: { mode: "pvst", prio: {} },
      mac: lab.mac || "00a1.0000.0300",
      links: lab.links || {},
      bridges: lab.bridges || {},
      warned: new Set(),
      ospf: null, bgp: null, routeTimes: {}, adjUp: new Set(), bgpUp: new Set(), pending: null,
    };
    if (router) {
      // ルータのポートは、最初は shutdown（IOS と同じ）
      (lab.ports || ["Gi0/0", "Gi0/1", "Gi0/2"]).forEach((k) => { st.ifs[k] = newIf(); st.ifs[k].shut = true; });
    } else {
      for (let i = 1; i <= PORTS; i++) st.ifs["Gi1/0/" + i] = newIf();
    }
    if (lab.setup) lab.setup(st);
    // 最初からできている隣接は、ログを出さずに覚えておく
    if (router) { routerLogs(st, () => {}); st.warned.clear(); }
    return st;
  }

  const adminMode = (ifc) => ifc.mode || "dynamic auto";
  const isProto = (m) => (m === "active" || m === "passive" ? "LACP" : m === "desirable" || m === "auto" ? "PAgP" : "-");

  function linkUp(st, k) {
    if (k.startsWith("Lo")) return !!st.ifs[k] && !st.ifs[k].shut;
    if (k.startsWith("Po")) return membersOf(st, k).some((m) => memberFlag(st, m) === "P");
    return !!st.links[k] && !st.ifs[k].shut;
  }
  function membersOf(st, po) {
    const g = +po.slice(2);
    return Object.keys(st.ifs).filter((k) => k.startsWith("Gi") && st.ifs[k].group === g).sort(ifSort);
  }
  // メンバーのポートの状態（P: 束に入っている、I: 単独、s: 設定の不一致で外された、D: ダウン）
  function memberFlag(st, k) {
    const ifc = st.ifs[k], link = st.links[k];
    if (!link || ifc.shut) return "D";
    const me = ifc.gmode, peer = link.chan || null;
    let ok;
    if (me === "on") ok = true;
    else if (me === "active" || me === "passive") ok = (peer === "active" || peer === "passive") && (me === "active" || peer === "active");
    else ok = (peer === "desirable" || peer === "auto") && (me === "desirable" || peer === "desirable");
    if (!ok) return "I";
    const po = st.ifs["Po" + ifc.group];
    if (po && !sameL2(ifc, po)) return "s";
    return "P";
  }
  // 画面に出すときのポート（束に入ったポートは Port-channel にまとめる）
  function logicalPorts(st) {
    const out = new Set();
    Object.keys(st.links).sort(ifSort).forEach((k) => {
      const ifc = st.ifs[k];
      if (ifc.group && memberFlag(st, k) === "P") out.add("Po" + ifc.group);
      else out.add(k);
    });
    return [...out];
  }
  function peerLink(st, k) {
    if (k.startsWith("Gi")) return st.links[k];
    const m = membersOf(st, k).find((x) => memberFlag(st, x) === "P");
    return m ? st.links[m] : null;
  }
  // DTP の結果、トランクとして動いているか
  function opTrunk(st, k) {
    const ifc = st.ifs[k];
    if (!ifc || !linkUp(st, k)) return false;
    const link = peerLink(st, k);
    if (!link) return false;
    const me = adminMode(ifc), peer = link.mode || "dynamic auto", peerSends = peer === "trunk" ? !link.nonego : peer === "dynamic desirable";
    if (me === "trunk") return true;
    if (me === "access") return false;
    if (me === "dynamic desirable") return peer === "dynamic desirable" || peer === "dynamic auto" || (peer === "trunk" && !link.nonego);
    return peerSends; // dynamic auto
  }
  const allowedHas = (ifc, v) => ifc.allowed == null || ifc.allowed.includes(v);

  // ---------------------------------------------------------------- STP
  const myPrio = (st, v) => (st.stp.prio[v] != null ? st.stp.prio[v] : 32768);
  function peerPrio(st, name, v) {
    const b = st.bridges[name] || {};
    return b.prio && b.prio[v] != null ? b.prio[v] : 32768;
  }
  function cmpBid(a, b) {
    return a.p - b.p || (a.mac < b.mac ? -1 : a.mac > b.mac ? 1 : 0);
  }
  function stpVlan(st, v) {
    const ext = st.stp.mode === "mst" ? 0 : v;
    const me = { name: st.host, p: (st.stp.mode === "mst" ? 32768 : myPrio(st, v)) + ext, base: st.stp.mode === "mst" ? 32768 : myPrio(st, v), mac: st.mac };
    const ports = [];
    logicalPorts(st).forEach((k) => {
      if (!linkUp(st, k)) return;
      const ifc = st.ifs[k], link = peerLink(st, k);
      const trunk = opTrunk(st, k);
      const carries = trunk ? allowedHas(ifc, v) && st.vlans.has(v) : (ifc.access || 1) === v;
      if (!carries) return;
      let nb = null;
      if (trunk && link.peer && st.bridges[link.peer]) {
        const b = st.bridges[link.peer];
        const base = st.stp.mode === "mst" ? 32768 : peerPrio(st, link.peer, v);
        nb = { name: link.peer, p: base + ext, base, mac: b.mac };
      }
      ports.push({ k, nb, cost: k.startsWith("Po") ? 3 : 4, edge: !trunk && ifc.portfast });
    });
    if (!ports.length) return null;
    let root = me;
    ports.forEach((p) => { if (p.nb && cmpBid(p.nb, root) < 0) root = p.nb; });
    const isRoot = root === me;
    let rootPort = null;
    if (!isRoot) rootPort = ports.find((p) => p.nb && p.nb.name === root.name);
    ports.forEach((p) => {
      if (isRoot || !p.nb) { p.role = "Desg"; p.sts = "FWD"; }
      else if (p === rootPort) { p.role = "Root"; p.sts = "FWD"; }
      else if (cmpBid(me, p.nb) < 0) { p.role = "Desg"; p.sts = "FWD"; }
      else { p.role = "Altn"; p.sts = "BLK"; }
    });
    return { me, root, isRoot, rootPort, ports, ext };
  }
  function rootPrimary(st, v, secondary) {
    if (secondary) return 28672;
    let rootP = Infinity;
    Object.keys(st.bridges).forEach((n) => (rootP = Math.min(rootP, peerPrio(st, n, v))));
    if (rootP > 24576) return 24576;
    return Math.max(0, rootP - 4096);
  }

  // ---------------------------------------------------------------- show の出力
  function vlanLabel(st, v) {
    if (v === 1) return "1 (default)";
    return v + " (" + (st.vlans.has(v) ? st.vlans.get(v) : "Inactive") + ")";
  }

  function showIfTrunk(st) {
    const tr = logicalPorts(st).filter((k) => opTrunk(st, k));
    if (!tr.length) return [];
    const modeName = (ifc) => ({ trunk: "on", "dynamic desirable": "desirable", "dynamic auto": "auto" }[adminMode(ifc)]);
    const out = ["", "Port        Mode             Encapsulation  Status        Native vlan"];
    tr.forEach((k) => out.push(pad(k, 12) + pad(modeName(st.ifs[k]), 17) + pad("802.1q", 15) + pad("trunking", 14) + st.ifs[k].native));
    out.push("", "Port        Vlans allowed on trunk");
    tr.forEach((k) => out.push(pad(k, 12) + fmtVlans(st.ifs[k].allowed)));
    out.push("", "Port        Vlans allowed and active in management domain");
    const active = (k) => [...st.vlans.keys()].filter((v) => allowedHas(st.ifs[k], v));
    tr.forEach((k) => out.push(pad(k, 12) + fmtVlans(active(k))));
    out.push("", "Port        Vlans in spanning tree forwarding state and not pruned");
    tr.forEach((k) => {
      const fwd = active(k).filter((v) => {
        const s = stpVlan(st, v);
        const p = s && s.ports.find((x) => x.k === k);
        return p && p.sts === "FWD";
      });
      out.push(pad(k, 12) + fmtVlans(fwd));
    });
    return out;
  }

  function showSwitchport(st, k) {
    const ifc = st.ifs[k];
    if (!ifc) return ["% Interface " + longIf(k) + " does not exist"];
    const trunk = opTrunk(st, k);
    const am = adminMode(ifc);
    const bundled = k.startsWith("Gi") && ifc.group && memberFlag(st, k) === "P";
    let om = !linkUp(st, k) ? "down" : trunk ? "trunk" : "static access";
    if (bundled) om = (opTrunk(st, "Po" + ifc.group) ? "trunk" : "static access") + " (member of bundle Po" + ifc.group + ")";
    return [
      "Name: " + k,
      "Switchport: Enabled",
      "Administrative Mode: " + (am === "access" ? "static access" : am),
      "Operational Mode: " + om,
      "Administrative Trunking Encapsulation: " + (ifc.encap === "negotiate" ? "negotiate" : "dot1q"),
      "Operational Trunking Encapsulation: " + (trunk ? "dot1q" : "native"),
      "Negotiation of Trunking: " + (ifc.nonego || am === "access" ? "Off" : "On"),
      "Access Mode VLAN: " + vlanLabel(st, ifc.access),
      "Trunking Native Mode VLAN: " + vlanLabel(st, ifc.native),
      "Administrative Native VLAN tagging: enabled",
      "Voice VLAN: none",
      "Administrative private-vlan host-association: none",
      "Operational private-vlan: none",
      "Trunking VLANs Enabled: " + (ifc.allowed == null ? "ALL" : fmtVlans(ifc.allowed).toUpperCase()),
      "Pruning VLANs Enabled: 2-1001",
      "Capture Mode Disabled",
      "Capture VLANs Allowed: ALL",
    ];
  }

  function showVlanBrief(st) {
    const out = ["", "VLAN Name                             Status    Ports", "---- -------------------------------- --------- -------------------------------"];
    const portsOf = (v) => {
      const list = [];
      Object.keys(st.ifs).sort(ifSort).forEach((k) => {
        const ifc = st.ifs[k];
        if (k.startsWith("Gi") && ifc.group && memberFlag(st, k) === "P") return;
        if (k.startsWith("Po") && !linkUp(st, k)) return;
        if (opTrunk(st, k)) return;
        if ((ifc.access || 1) === v) list.push(k);
      });
      return list;
    };
    const vlans = [...st.vlans.keys()].sort((a, b) => a - b);
    vlans.forEach((v) => {
      const ports = portsOf(v);
      const head = pad(v, 5) + pad(st.vlans.get(v), 33) + pad("active", 10);
      if (!ports.length) { out.push(head.trimEnd()); return; }
      for (let i = 0; i < ports.length; i += 3) {
        out.push((i === 0 ? head : " ".repeat(48)) + ports.slice(i, i + 3).join(", "));
      }
    });
    [["1002", "fddi-default"], ["1003", "token-ring-default"], ["1004", "fddinet-default"], ["1005", "trnet-default"]].forEach(([v, n]) =>
      out.push(pad(v, 5) + pad(n, 33) + "act/unsup"));
    return out;
  }

  function showEtherchannel(st) {
    const pos = Object.keys(st.ifs).filter((k) => k.startsWith("Po")).sort(ifSort);
    const out = [
      "Flags:  D - down        P - bundled in port-channel",
      "        I - stand-alone s - suspended",
      "        H - Hot-standby (LACP only)",
      "        R - Layer3      S - Layer2",
      "        U - in use      f - failed to allocate aggregator",
      "",
      "Number of channel-groups in use: " + pos.length,
      "Number of aggregators:           " + pos.length,
      "",
      "Group  Port-channel  Protocol    Ports",
      "------+-------------+-----------+-----------------------------------------------",
    ];
    pos.forEach((po) => {
      const mem = membersOf(st, po);
      const proto = mem.length ? isProto(st.ifs[mem[0]].gmode) : "-";
      const flag = "(S" + (linkUp(st, po) ? "U" : "D") + ")";
      out.push(pad(po.slice(2), 7) + pad(po + flag, 16) + pad(proto, 10) + mem.map((m) => m + "(" + memberFlag(st, m) + ")").join("  "));
    });
    return out;
  }

  function stpBlock(st, v) {
    const s = stpVlan(st, v);
    if (!s) return null;
    const proto = st.stp.mode === "rapid-pvst" ? "rstp" : st.stp.mode === "mst" ? "mstp" : "ieee";
    const timers = "             Hello Time   2 sec  Max Age 20 sec  Forward Delay 15 sec";
    const out = [st.stp.mode === "mst" ? "MST0" : "VLAN" + String(v).padStart(4, "0"), "  Spanning tree enabled protocol " + proto];
    out.push("  Root ID    Priority    " + s.root.p, "             Address     " + s.root.mac);
    if (s.isRoot) out.push("             This bridge is the root");
    else out.push("             Cost        " + s.rootPort.cost, "             Port        " + ifNum(s.rootPort.k) + " (" + longIf(s.rootPort.k) + ")");
    out.push(timers, "");
    out.push("  Bridge ID  Priority    " + s.me.p + "  (priority " + s.me.base + " sys-id-ext " + s.ext + ")", "             Address     " + s.me.mac, timers, "             Aging Time  300 sec", "");
    out.push("Interface           Role Sts Cost      Prio.Nbr Type", "------------------- ---- --- --------- -------- --------------------------------");
    s.ports.forEach((p) => out.push(pad(p.k, 20) + p.role + " " + p.sts + " " + pad(p.cost, 10) + pad("128." + (p.k.startsWith("Po") ? 64 + ifNum(p.k) : ifNum(p.k)), 9) + "P2p" + (p.edge ? " Edge" : "")));
    return out;
  }
  function showStp(st, v) {
    if (v != null) {
      const b = stpBlock(st, v);
      return b ? [""].concat(b) : ["Spanning tree instance(s) for vlan " + v + " does not exist."];
    }
    const vlans = st.stp.mode === "mst" ? [1] : [...st.vlans.keys()].sort((a, b) => a - b);
    const out = [];
    vlans.forEach((x) => {
      const b = stpBlock(st, x);
      if (b) out.push("", ...b);
    });
    return out.length ? out : ["No spanning tree instance exists."];
  }

  function ifConfigLines(st, k) {
    const c = st.ifs[k], out = ["interface " + longIf(k)];
    if (c.desc) out.push(" description " + c.desc);
    if (c.access !== 1) out.push(" switchport access vlan " + c.access);
    if (c.encap) out.push(" switchport trunk encapsulation " + c.encap);
    if (c.native !== 1) out.push(" switchport trunk native vlan " + c.native);
    if (c.allowed != null) out.push(" switchport trunk allowed vlan " + fmtVlans(c.allowed));
    if (c.mode) out.push(" switchport mode " + c.mode);
    if (c.nonego) out.push(" switchport nonegotiate");
    if (c.shut) out.push(" shutdown");
    if (c.portfast) out.push(" spanning-tree portfast");
    if (c.bpduguard) out.push(" spanning-tree bpduguard enable");
    if (c.group) out.push(" channel-group " + c.group + " mode " + c.gmode);
    return out;
  }
  function withHeader(body) {
    const text = body.join("\n");
    return ["Building configuration...", "", "Current configuration : " + (text.length + 1) + " bytes"].concat(body);
  }
  function showRun(st) {
    const body = ["!", "version 17.9", "hostname " + st.host, "!", "vtp mode transparent", "!", "spanning-tree mode " + st.stp.mode, "spanning-tree extend system-id"];
    Object.keys(st.stp.prio).map(Number).sort((a, b) => a - b).forEach((v) => body.push("spanning-tree vlan " + v + " priority " + st.stp.prio[v]));
    body.push("!");
    [...st.vlans.keys()].filter((v) => v !== 1).sort((a, b) => a - b).forEach((v) => {
      body.push("vlan " + v);
      if (st.vlans.get(v) !== vlanName(v)) body.push(" name " + st.vlans.get(v));
      body.push("!");
    });
    Object.keys(st.ifs).sort(ifSort).forEach((k) => body.push(...ifConfigLines(st, k), "!"));
    body.push("end");
    return withHeader(body);
  }
  function showRunIf(st, k) {
    if (!st.ifs[k]) return ["%Invalid interface type and number"];
    return withHeader(["!", ...(st.dev === "rt" ? routerIfLines(st, k) : ifConfigLines(st, k)), "end"]);
  }

  // ---------------------------------------------------------------- ルータ: IP アドレス
  function parseIp(t) {
    const m = String(t).match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (!m || m.slice(1).some((x) => +x > 255)) return null;
    return m.slice(1).map(Number).join(".");
  }
  const ip2n = (s) => s.split(".").reduce((a, x) => a * 256 + +x, 0);
  const n2ip = (n) => [24, 16, 8, 0].map((b) => Math.floor(n / 2 ** b) % 256).join(".");
  const len2n = (len) => 2 ** 32 - 2 ** (32 - len);
  function maskLen(mask) {
    const n = ip2n(mask);
    for (let len = 0; len <= 32; len++) if (len2n(len) === n) return len;
    return null; // 1 が連続していないマスク
  }
  const lenMask = (len) => n2ip(len2n(len));
  const netOf = (addr, len) => n2ip(ip2n(addr) - (ip2n(addr) % 2 ** (32 - len)));
  const inNet = (addr, net, len) => netOf(addr, len) === net;
  const classfulLen = (net) => { const a = +net.split(".")[0]; return a < 128 ? 8 : a < 192 ? 16 : 24; };
  const areaNum = (a) => (String(a).includes(".") ? ip2n(String(a)) : +a);
  const ifLen = (c) => maskLen(c.ip.mask);
  // ワイルドカードマスクで一致を見る（0 のビットだけ比べる）
  const wildMatch = (addr, net, wild) => ((ip2n(addr) & ~ip2n(wild)) >>> 0) === ((ip2n(net) & ~ip2n(wild)) >>> 0);

  function setIp(st, k, addr, mask) {
    if (!st.ifs[k]) st.ifs[k] = newIf();
    st.ifs[k].ip = { addr, mask };
    st.ifs[k].shut = false;
  }

  // 直結の経路（C と L）
  function connectedRoutes(st) {
    const out = [];
    Object.keys(st.ifs).forEach((k) => {
      const c = st.ifs[k];
      if (!c.ip || !linkUp(st, k)) return;
      const len = ifLen(c);
      out.push({ code: "C", net: netOf(c.ip.addr, len), len, ad: 0, metric: 0, ifk: k });
      if (len < 32) out.push({ code: "L", net: c.ip.addr, len: 32, ad: 0, metric: 0, ifk: k });
    });
    return out;
  }

  // ---------------------------------------------------------------- ルータ: OSPF
  function newOspf(st, pid) {
    return { pid, cfgRid: null, rid: ridCandidate(st), networks: [], passive: [], nonPassive: [], passiveDefault: false, refbw: 100 };
  }
  // ルータ ID の候補: いちばん大きいループバックの IP、なければ動いているインタフェースのいちばん大きい IP
  function ridCandidate(st) {
    const ips = (f) => Object.keys(st.ifs).filter(f).map((k) => st.ifs[k].ip.addr);
    let pool = ips((k) => k.startsWith("Lo") && st.ifs[k].ip && !st.ifs[k].shut);
    if (!pool.length) pool = ips((k) => st.ifs[k].ip && linkUp(st, k));
    return pool.sort((a, b) => ip2n(b) - ip2n(a))[0] || null;
  }
  // そのインタフェースが OSPF のどのエリアに入っているか（インタフェースでの設定が network より優先）
  function ospfArea(st, k) {
    const c = st.ifs[k];
    if (!st.ospf || !c || !c.ip || !linkUp(st, k)) return null;
    if (c.ospfArea != null && c.ospfPid === st.ospf.pid) return { area: c.ospfArea, how: "Interface Enable" };
    const hit = st.ospf.networks.find((n) => wildMatch(c.ip.addr, n.addr, n.wild));
    return hit ? { area: hit.area, how: "Network Statement" } : null;
  }
  function isPassive(st, k) {
    const o = st.ospf;
    return o.passiveDefault ? !o.nonPassive.includes(k) : o.passive.includes(k);
  }
  const ospfNetType = (st, k) => (k.startsWith("Lo") ? "LOOPBACK" : st.ifs[k].ospfNet === "point-to-point" ? "POINT_TO_POINT" : "BROADCAST");
  const helloOf = (c) => c.hello || 10;
  const deadOf = (c) => c.dead || helloOf(c) * 4;
  function ospfCost(st, k) {
    const c = st.ifs[k];
    if (c.ospfCost) return c.ospfCost;
    if (k.startsWith("Lo")) return 1;
    return Math.max(1, Math.floor(st.ospf.refbw / 1000)); // GigabitEthernet は 1000 Mbps
  }

  // 隣接: リンクの相手ごとに、条件がそろっているかを見る
  function ospfAdj(st) {
    const out = [];
    if (!st.ospf || !st.ospf.rid) return out;
    Object.keys(st.links).sort(ifSortBrief).forEach((k) => {
      const p = st.links[k].ospf;
      if (!p) return;
      const c = st.ifs[k], a = ospfArea(st, k);
      if (!a || isPassive(st, k)) return;
      const len = ifLen(c);
      let fail = null;
      if (!inNet(p.ip, netOf(c.ip.addr, len), len) || (p.len || len) !== len) fail = "subnet";
      else if (areaNum(a.area) !== areaNum(p.area)) fail = "area";
      else if (helloOf(c) !== (p.hello || 10) || deadOf(c) !== (p.dead || (p.hello || 10) * 4)) fail = "timers";
      else if (p.rid === st.ospf.rid) fail = "rid";
      const myType = ospfNetType(st, k);
      const peerType = p.net === "point-to-point" ? "POINT_TO_POINT" : "BROADCAST";
      let myRole = "P2P", peerRole = "-", dr = null, bdr = null;
      if (myType === "BROADCAST") {
        // DR・BDR の選出: 優先度が大きい方、同じならルータ ID が大きい方。優先度 0 はならない
        const me = { who: "me", prio: c.ospfPrio != null ? c.ospfPrio : 1, rid: st.ospf.rid, ip: c.ip.addr };
        const him = { who: "him", prio: p.prio != null ? p.prio : 1, rid: p.rid, ip: p.ip };
        const cand = (fail ? [me] : [me, him]).filter((x) => x.prio > 0)
          .sort((x, y) => y.prio - x.prio || ip2n(y.rid) - ip2n(x.rid));
        dr = cand[0] || null;
        bdr = cand[1] || null;
        const role = (w) => (dr && dr.who === w ? "DR" : bdr && bdr.who === w ? "BDR" : "DROTHER");
        myRole = role("me");
        peerRole = role("him");
      }
      out.push({ k, p, fail, full: !fail, myType, peerType, myRole, peerRole, dr, bdr, area: a.area, routesOk: !fail && myType === peerType });
    });
    return out;
  }

  function ospfRoutes(st) {
    const best = new Map();
    ospfAdj(st).filter((n) => n.routesOk).forEach((n) => {
      (n.p.routes || []).forEach((r) => {
        const e2 = r.type === "O E2";
        const metric = e2 ? r.cost : r.cost + ospfCost(st, n.k);
        const key = r.net + "/" + r.len;
        const entry = { code: r.type || "O", net: r.net, len: r.len, ad: 110, metric, via: [{ ip: n.p.ip, ifk: n.k }] };
        const cur = best.get(key);
        if (!cur || metric < cur.metric) best.set(key, entry);
        else if (metric === cur.metric) cur.via.push(entry.via[0]);
      });
    });
    return [...best.values()];
  }

  // ---------------------------------------------------------------- ルータ: BGP
  function bgpPeers(st) {
    const out = [];
    if (!st.bgp) return out;
    st.bgp.neighbors.forEach((nb, ip) => {
      let link = null, k = null;
      Object.keys(st.links).forEach((x) => { if (st.links[x].bgp && st.links[x].bgp.ip === ip) { link = st.links[x].bgp; k = x; } });
      const c = k && st.ifs[k];
      let state = "Established", why = null;
      if (!link || !linkUp(st, k) || !c.ip || !inNet(ip, netOf(c.ip.addr, ifLen(c)), ifLen(c))) state = "Active"; // 相手に届かない
      else if (nb.remoteAs !== link.as) { state = "Idle"; why = "sent"; } // 相手の AS 番号の書き間違い
      else if (st.bgp.asn !== link.expectAs) { state = "Idle"; why = "recv"; } // 自分の AS 番号が相手の設定と違う
      else if (link.expectIp && link.expectIp !== c.ip.addr) state = "Active";
      out.push({ ip, nb, link, k, state, why });
    });
    return out;
  }
  const bgpRid = (st) => st.bgp.rid || ridCandidate(st) || "0.0.0.0";
  function bgpRoutes(st) {
    const out = [];
    bgpPeers(st).filter((p) => p.state === "Established").forEach((p) =>
      (p.link.routes || []).forEach((r) => out.push({ code: "B", net: r.net, len: r.len, ad: 20, metric: r.med || 0, via: [{ ip: p.ip }], path: r.path || String(p.link.as), origin: r.origin || "i" })));
    return out;
  }
  // network コマンドの経路は、ルーティングテーブルに同じ長さで載っているときだけ BGP の表に入る
  function bgpLocal(st) {
    const table = rib(st, true);
    return st.bgp.networks.filter((n) => table.some((r) => r.net === n.net && r.len === n.len && r.code !== "L"));
  }

  // ---------------------------------------------------------------- ルータ: ルーティングテーブル
  function rib(st, noBgp) {
    const cand = connectedRoutes(st).concat(ospfRoutes(st), !noBgp && st.bgp ? bgpRoutes(st) : []);
    const best = new Map();
    cand.forEach((r) => {
      const key = r.net + "/" + r.len;
      const cur = best.get(key);
      if (!cur || r.ad < cur.ad || (r.ad === cur.ad && r.metric < cur.metric)) best.set(key, r);
    });
    return [...best.values()].sort((a, b) => ip2n(a.net) - ip2n(b.net) || a.len - b.len);
  }
  function lookup(st, ip) {
    return rib(st).filter((r) => inNet(ip, r.net, r.len)).sort((a, b) => b.len - a.len)[0] || null;
  }
  function age(st, key) {
    if (!st.routeTimes[key]) st.routeTimes[key] = Date.now();
    const s = Math.floor((Date.now() - st.routeTimes[key]) / 1000);
    return [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60].map((x) => String(x).padStart(2, "0")).join(":");
  }

  const ROUTE_CODES = [
    "Codes: L - local, C - connected, S - static, R - RIP, M - mobile, B - BGP",
    "       D - EIGRP, EX - EIGRP external, O - OSPF, IA - OSPF inter area",
    "       N1 - OSPF NSSA external type 1, N2 - OSPF NSSA external type 2",
    "       E1 - OSPF external type 1, E2 - OSPF external type 2",
    "       i - IS-IS, su - IS-IS summary, L1 - IS-IS level-1, L2 - IS-IS level-2",
    "       ia - IS-IS inter area, * - candidate default, U - per-user static route",
    "       o - ODR, P - periodic downloaded static route, H - NHRP, l - LISP",
    "       a - application route",
    "       + - replicated route, % - next hop override, p - overrides from PfR",
    "",
  ];
  function showIpRoute(st, only) {
    const all = rib(st);
    const routes = all.filter((r) => !only || (only === "connected" ? r.code === "C" || r.code === "L" : r.code.startsWith(only === "ospf" ? "O" : "B")));
    const out = ROUTE_CODES.slice();
    const def = all.find((r) => r.len === 0 && r.via);
    out.push(def ? "Gateway of last resort is " + def.via[0].ip + " to network 0.0.0.0" : "Gateway of last resort is not set", "");
    const emitRoute = (r, width, withLen) => {
      const code = r.len === 0 ? r.code + "*" : r.code;
      const dest = r.net + (withLen ? "/" + r.len : "");
      if (!r.via) { out.push(code.padEnd(width) + dest + " is directly connected, " + longIf(r.ifk)); return; }
      const t = age(st, r.code + r.net + "/" + r.len);
      r.via.forEach((v, i) => {
        const body = "[" + r.ad + "/" + r.metric + "] via " + v.ip + ", " + t + (v.ifk ? ", " + longIf(v.ifk) : "");
        out.push(i === 0 ? code.padEnd(width) + dest + " " + body : " ".repeat(width + dest.length + 1) + body);
      });
    };
    // クラスフルのネットワークごとにまとめて出す（IOS と同じ）
    const groups = new Map();
    routes.forEach((r) => {
      const cl = classfulLen(r.net);
      const key = r.len < cl ? "super " + r.net + "/" + r.len : netOf(r.net, cl) + "/" + cl;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(r);
    });
    groups.forEach((rs, key) => {
      if (key.startsWith("super ") || (rs.length === 1 && rs[0].len === classfulLen(rs[0].net))) { rs.forEach((r) => emitRoute(r, 6, true)); return; }
      const [major, cl] = key.split("/");
      const lens = new Set(rs.map((r) => r.len));
      if (lens.size === 1) out.push("      " + major + "/" + [...lens][0] + " is subnetted, " + rs.length + " subnets");
      else out.push("      " + major + "/" + cl + " is variably subnetted, " + rs.length + " subnets, " + lens.size + " masks");
      rs.forEach((r) => emitRoute(r, 9, lens.size > 1));
    });
    return out;
  }

  function showIpIntBrief(st) {
    const out = ["Interface              IP-Address      OK? Method Status                Protocol"];
    Object.keys(st.ifs).sort(ifSortBrief).forEach((k) => {
      const c = st.ifs[k];
      const status = c.shut ? "administratively down" : linkUp(st, k) ? "up" : "down";
      const proto = linkUp(st, k) ? "up" : "down";
      out.push(pad(longIf(k), 23) + pad(c.ip ? c.ip.addr : "unassigned", 16) + "YES " + pad(c.ip ? "manual" : "unset", 7) + pad(status, 22) + proto);
    });
    return out;
  }

  function showOspfNeighbor(st) {
    const out = ["", "Neighbor ID     Pri   State           Dead Time   Address         Interface"];
    const now = Math.floor(Date.now() / 1000);
    ospfAdj(st).filter((n) => n.full).forEach((n) => {
      const c = st.ifs[n.k];
      const dead = deadOf(c) - (now % helloOf(c));
      const state = "FULL/" + (n.myType === "BROADCAST" ? n.peerRole : " -");
      out.push(pad(n.p.rid, 16) + String(n.p.prio != null ? n.p.prio : 1).padStart(3) + "   " + pad(state, 16) + pad("00:00:" + String(dead).padStart(2, "0"), 12) + pad(n.p.ip, 16) + longIf(n.k));
    });
    return out;
  }

  const ospfIfs = (st) => Object.keys(st.ifs).sort(ifSortRun).filter((k) => ospfArea(st, k));
  function ospfIfState(st, k) {
    const type = ospfNetType(st, k);
    if (type === "LOOPBACK") return "LOOP";
    if (type === "POINT_TO_POINT") return "P2P";
    const n = ospfAdj(st).find((x) => x.k === k);
    return n ? n.myRole : "DR";
  }
  function showOspfIntBrief(st) {
    const out = ["Interface    PID   Area            IP Address/Mask    Cost  State Nbrs F/C"];
    ospfIfs(st).forEach((k) => {
      const c = st.ifs[k], a = ospfArea(st, k);
      const nb = ospfAdj(st).filter((x) => x.k === k && x.full).length;
      out.push(pad(k, 13) + pad(st.ospf.pid, 6) + pad(a.area, 16) + pad(c.ip.addr + "/" + ifLen(c), 19) + pad(ospfCost(st, k), 6) + pad(ospfIfState(st, k), 6) + nb + "/" + nb);
    });
    return out;
  }
  function showOspfInt(st, k) {
    const c = st.ifs[k];
    if (!c) return ["%Invalid interface type and number"];
    const up = linkUp(st, k);
    const head = longIf(k) + " is " + (c.shut ? "administratively down" : up ? "up" : "down") + ", line protocol is " + (up ? "up" : "down") + " ";
    const a = ospfArea(st, k);
    if (!a) return [head, "  OSPF not enabled on this interface"];
    const type = ospfNetType(st, k);
    const out = [
      head,
      "  Internet Address " + c.ip.addr + "/" + ifLen(c) + ", Area " + a.area + ", Attached via " + a.how,
      "  Process ID " + st.ospf.pid + ", Router ID " + st.ospf.rid + ", Network Type " + type + ", Cost: " + ospfCost(st, k),
    ];
    if (type === "LOOPBACK") return out.concat(["  Loopback interface is treated as a stub Host"]);
    const n = ospfAdj(st).find((x) => x.k === k);
    const prio = c.ospfPrio != null ? c.ospfPrio : 1;
    out.push("  Transmit Delay is 1 sec, State " + ospfIfState(st, k) + (type === "BROADCAST" ? ", Priority " + prio : ""));
    if (type === "BROADCAST") {
      const who = (x) => (x.who === "me" ? st.ospf.rid + ", Interface address " + c.ip.addr : x.rid + ", Interface address " + x.ip);
      if (n && n.dr) out.push("  Designated Router (ID) " + who(n.dr));
      else if (!n) out.push("  Designated Router (ID) " + st.ospf.rid + ", Interface address " + c.ip.addr);
      if (n && n.bdr) out.push("  Backup Designated router (ID) " + who(n.bdr));
      else out.push("  No backup designated router on this network");
    }
    out.push("  Timer intervals configured, Hello " + helloOf(c) + ", Dead " + deadOf(c) + ", Wait " + deadOf(c) + ", Retransmit 5");
    if (isPassive(st, k)) out.push("    No Hellos (Passive interface)");
    else out.push("    Hello due in 00:00:0" + (helloOf(c) > 9 ? 3 : 1));
    const full = n && n.full ? 1 : 0;
    out.push("  Neighbor Count is " + full + ", Adjacent neighbor count is " + full);
    if (full) out.push("    Adjacent with neighbor " + n.p.rid + (n.peerRole === "DR" ? "  (Designated Router)" : n.peerRole === "BDR" ? "  (Backup Designated Router)" : ""));
    out.push("  Suppress hello for 0 neighbor(s)");
    return out;
  }

  function showIpProtocols(st) {
    const out = ["*** IP Routing is NSF aware ***", ""];
    if (st.ospf) {
      const o = st.ospf;
      const areas = new Set(ospfIfs(st).map((k) => areaNum(ospfArea(st, k).area)));
      out.push('Routing Protocol is "ospf ' + o.pid + '"', "  Outgoing update filter list for all interfaces is not set", "  Incoming update filter list for all interfaces is not set",
        "  Router ID " + o.rid, "  Number of areas in this router is " + areas.size + ". " + areas.size + " normal 0 stub 0 nssa", "  Maximum path: 4", "  Routing for Networks:");
      o.networks.forEach((n) => out.push("    " + n.addr + " " + n.wild + " area " + n.area));
      const explicit = ospfIfs(st).filter((k) => ospfArea(st, k).how === "Interface Enable");
      if (explicit.length) out.push("  Routing on Interfaces Configured Explicitly:", ...explicit.map((k) => "    " + longIf(k)));
      const pas = Object.keys(st.ifs).sort(ifSortBrief).filter((k) => !k.startsWith("Lo") && isPassive(st, k));
      if (pas.length) out.push("  Passive Interface(s):", ...pas.map((k) => "    " + longIf(k)));
      out.push("  Routing Information Sources:", "    Gateway         Distance      Last Update");
      ospfAdj(st).filter((n) => n.routesOk).forEach((n) => out.push("    " + pad(n.p.rid, 16) + String(110).padStart(8) + "      " + age(st, "src" + n.p.rid)));
      out.push("  Distance: (default is 110)", "");
    }
    if (st.bgp) {
      out.push('Routing Protocol is "bgp ' + st.bgp.asn + '"', "  Outgoing update filter list for all interfaces is not set", "  Incoming update filter list for all interfaces is not set",
        "  IGP synchronization is disabled", "  Automatic route summarization is disabled", "  Neighbor(s):", "    Address          FiltIn FiltOut DistIn DistOut Weight RouteMap");
      st.bgp.neighbors.forEach((nb, ip) => out.push("    " + ip));
      out.push("  Maximum path: 1", "  Distance: external 20 internal 200 local 200", "");
    }
    return out;
  }

  function showBgpSummary(st) {
    if (!st.bgp) return ["% BGP not active"];
    const peers = bgpPeers(st);
    const local = bgpLocal(st), recv = bgpRoutes(st);
    const ver = local.length + recv.length + 1;
    const out = [
      "BGP router identifier " + bgpRid(st) + ", local AS number " + st.bgp.asn,
      "BGP table version is " + ver + ", main routing table version " + ver,
      local.length + recv.length + " network entries using " + (local.length + recv.length) * 248 + " bytes of memory",
      "",
      "Neighbor        V           AS MsgRcvd MsgSent   TblVer  InQ OutQ Up/Down  State/PfxRcd",
    ];
    peers.forEach((p) => {
      const est = p.state === "Established";
      const n = est ? (p.link.routes || []).length : 0;
      out.push(pad(p.ip, 16) + "4" + String(p.nb.remoteAs).padStart(13) + String(est ? 8 : 0).padStart(8) + String(est ? 7 : 0).padStart(8) + String(est ? ver : 1).padStart(9) +
        "    0    0 " + pad(est ? age(st, "bgp" + p.ip) : "never", 9) + (est ? String(n).padStart(8) : p.state));
    });
    return out;
  }
  function showBgp(st) {
    if (!st.bgp) return ["% BGP not active"];
    const rows = bgpLocal(st).map((n) => ({ net: n.net, len: n.len, nh: "0.0.0.0", metric: "0", weight: 32768, path: "", origin: "i" }))
      .concat(bgpRoutes(st).map((r) => ({ net: r.net, len: r.len, nh: r.via[0].ip, metric: String(r.metric), weight: 0, path: r.path + " ", origin: r.origin })))
      .sort((a, b) => ip2n(a.net) - ip2n(b.net));
    if (!rows.length) return [];
    const out = [
      "BGP table version is " + (rows.length + 1) + ", local router ID is " + bgpRid(st),
      "Status codes: s suppressed, d damped, h history, * valid, > best, i - internal,",
      "              r RIB-failure, S Stale, m multipath, b backup-path, f RT-Filter,",
      "              x best-external, a additional-path, c RIB-compressed,",
      "              t secondary path, L long-lived-stale,",
      "Origin codes: i - IGP, e - EGP, ? - incomplete",
      "RPKI validation codes: V valid, I invalid, N Not found",
      "",
      "     Network          Next Hop            Metric LocPrf Weight Path",
    ];
    rows.forEach((r) => {
      const net = r.len === classfulLen(r.net) && r.net.endsWith(".0") && r.len !== 0 ? r.net : r.len === 0 ? r.net : r.net + "/" + r.len;
      out.push(" *>   " + pad(net, 17) + pad(r.nh, 20) + String(r.metric).padStart(6) + "       " + String(r.weight).padStart(6) + " " + r.path + r.origin);
    });
    return out;
  }

  function ping(st, ip) {
    const local = Object.values(st.ifs).some((c) => c.ip && c.ip.addr === ip);
    const r = lookup(st, ip);
    let ok = local;
    if (!ok && r) {
      if (r.via) ok = true;
      else ok = Object.keys(st.links).some((k) => k === r.ifk && [st.links[k].ospf, st.links[k].bgp, st.links[k]].some((x) => x && (x.ip === ip || (x.hosts || []).includes(ip))));
    }
    return [
      "Type escape sequence to abort.",
      "Sending 5, 100-byte ICMP Echos to " + ip + ", timeout is 2 seconds:",
      ok ? "!!!!!" : ".....",
      ok ? "Success rate is 100 percent (5/5), round-trip min/avg/max = 1/1/2 ms" : "Success rate is 0 percent (0/5)",
    ];
  }

  function routerIfLines(st, k) {
    const c = st.ifs[k], out = ["interface " + longIf(k)];
    if (c.desc) out.push(" description " + c.desc);
    out.push(c.ip ? " ip address " + c.ip.addr + " " + c.ip.mask : " no ip address");
    if (c.ospfNet) out.push(" ip ospf network " + c.ospfNet);
    if (c.hello) out.push(" ip ospf hello-interval " + c.hello);
    if (c.dead) out.push(" ip ospf dead-interval " + c.dead);
    if (c.ospfPrio != null) out.push(" ip ospf priority " + c.ospfPrio);
    if (c.ospfArea != null) out.push(" ip ospf " + c.ospfPid + " area " + c.ospfArea);
    if (c.ospfCost) out.push(" ip ospf cost " + c.ospfCost);
    if (c.shut) out.push(" shutdown");
    return out;
  }
  function showRunRouter(st) {
    const body = ["!", "version 17.9", "hostname " + st.host, "!"];
    Object.keys(st.ifs).sort(ifSortRun).forEach((k) => body.push(...routerIfLines(st, k), "!"));
    if (st.ospf) {
      const o = st.ospf;
      body.push("router ospf " + o.pid);
      if (o.cfgRid) body.push(" router-id " + o.cfgRid);
      if (o.refbw !== 100) body.push(" auto-cost reference-bandwidth " + o.refbw);
      if (o.passiveDefault) body.push(" passive-interface default", ...o.nonPassive.sort(ifSortBrief).map((k) => " no passive-interface " + longIf(k)));
      else body.push(...o.passive.sort(ifSortBrief).map((k) => " passive-interface " + longIf(k)));
      o.networks.forEach((n) => body.push(" network " + n.addr + " " + n.wild + " area " + n.area));
      body.push("!");
    }
    if (st.bgp) {
      body.push("router bgp " + st.bgp.asn);
      if (st.bgp.rid) body.push(" bgp router-id " + st.bgp.rid);
      body.push(" bgp log-neighbor-changes");
      st.bgp.networks.forEach((n) => body.push(" network " + n.net + (n.len === classfulLen(n.net) ? "" : " mask " + lenMask(n.len))));
      st.bgp.neighbors.forEach((nb, ip) => body.push(" neighbor " + ip + " remote-as " + nb.remoteAs));
      body.push("!");
    }
    body.push("end");
    return withHeader(body);
  }

  // ---------------------------------------------------------------- ルータのコマンド
  const ospfOnIfs = (c, fn) => c.st.ctx.forEach((k) => fn(c.st.ifs[k], k));
  function needOspf(c) {
    return c.st.ospf;
  }
  const ROUTER_DEFS = [
    ["user priv", "show ip interface brief", (c) => c.out(showIpIntBrief(c.st)), "rt"],
    ["user priv", "show ip route", (c) => c.out(showIpRoute(c.st)), "rt"],
    ["user priv", "show ip route (ospf|bgp|connected)", (c) => c.out(showIpRoute(c.st, c.cmd.ctx.split(" ").pop())), "rt"],
    ["user priv", "show ip ospf neighbor", (c) => c.out(c.st.ospf ? showOspfNeighbor(c.st) : []), "rt"],
    ["user priv", "show ip ospf interface", (c) => c.out(c.st.ospf ? ospfIfs(c.st).flatMap((k) => showOspfInt(c.st, k)) : []), "rt"],
    ["user priv", "show ip ospf interface brief", (c) => c.out(c.st.ospf ? showOspfIntBrief(c.st) : []), "rt"],
    ["user priv", "show ip ospf interface <if>", (c) => c.out(c.st.ospf ? showOspfInt(c.st, c.args[0]) : []), "rt"],
    ["user priv", "show ip protocols", (c) => c.out(showIpProtocols(c.st)), "rt"],
    ["user priv", "show ip bgp", (c) => c.out(showBgp(c.st)), "rt"],
    ["user priv", "show ip bgp summary", (c) => c.out(showBgpSummary(c.st)), "rt"],
    ["user priv", "ping <ip>", (c) => c.out(ping(c.st, c.args[0])), "rt"],
    ["priv", "clear ip ospf process", (c) => c.confirm("Reset ALL OSPF processes? [no]: ", () => {
      if (!c.st.ospf) return;
      c.st.ospf.rid = c.st.ospf.cfgRid || ridCandidate(c.st);
      c.st.ospfRestart = true;
    }), "rt"],

    ["config", "router ospf <pid>", (c) => {
      if (c.st.ospf && c.st.ospf.pid !== c.args[0]) { c.out(["% 演習では OSPF のプロセスは1つだけ使える（いまはプロセス " + c.st.ospf.pid + "）"]); return; }
      if (!c.st.ospf) c.st.ospf = newOspf(c.st, c.args[0]);
      c.st.mode = "rospf"; c.st.ctx = null;
    }, "rt"],
    ["config", "no router ospf <pid>", (c) => { if (c.st.ospf && c.st.ospf.pid === c.args[0]) c.st.ospf = null; }, "rt"],
    ["config", "router bgp <asn>", (c) => {
      if (c.st.bgp && c.st.bgp.asn !== c.args[0]) { c.out(["% BGP is already running; AS is " + c.st.bgp.asn]); return; }
      if (!c.st.bgp) c.st.bgp = { asn: c.args[0], rid: null, neighbors: new Map(), networks: [] };
      c.st.mode = "rbgp"; c.st.ctx = null;
    }, "rt"],
    ["config", "no router bgp <asn>", (c) => { if (c.st.bgp && c.st.bgp.asn === c.args[0]) c.st.bgp = null; }, "rt"],

    ["if", "ip address <ip> <mask>", (c) => {
      const [addr, mask] = c.args, len = maskLen(mask);
      if (len == null) { c.out(["Bad mask 0x" + ip2n(mask).toString(16).toUpperCase() + " for address " + addr]); return; }
      const k = c.st.ctx[0];
      const clash = Object.keys(c.st.ifs).find((x) => x !== k && c.st.ifs[x].ip && !c.st.ifs[x].shut &&
        (inNet(addr, netOf(c.st.ifs[x].ip.addr, ifLen(c.st.ifs[x])), Math.min(len, ifLen(c.st.ifs[x])))));
      if (clash) { c.out(["% " + netOf(addr, len) + " overlaps with " + longIf(clash)]); return; }
      c.st.ifs[k].ip = { addr, mask };
    }, "rt"],
    ["if", "no ip address", (c) => ospfOnIfs(c, (i) => (i.ip = null)), "rt"],
    ["if", "ip ospf <pid> area <area>", (c) => ospfOnIfs(c, (i) => { i.ospfPid = c.args[0]; i.ospfArea = c.args[1]; }), "rt"],
    ["if", "no ip ospf <pid> area <area>", (c) => ospfOnIfs(c, (i) => { i.ospfPid = null; i.ospfArea = null; }), "rt"],
    ["if", "no ip ospf <pid> area", (c) => ospfOnIfs(c, (i) => { i.ospfPid = null; i.ospfArea = null; }), "rt"],
    ["if", "ip ospf cost <cost>", (c) => ospfOnIfs(c, (i) => (i.ospfCost = c.args[0])), "rt"],
    ["if", "no ip ospf cost", (c) => ospfOnIfs(c, (i) => (i.ospfCost = null)), "rt"],
    ["if", "ip ospf priority <oprio>", (c) => ospfOnIfs(c, (i) => (i.ospfPrio = c.args[0])), "rt"],
    ["if", "no ip ospf priority", (c) => ospfOnIfs(c, (i) => (i.ospfPrio = null)), "rt"],
    ["if", "ip ospf network (point-to-point|broadcast)", (c) => ospfOnIfs(c, (i) => (i.ospfNet = c.cmd.ctx.endsWith("point-to-point") ? "point-to-point" : null)), "rt"],
    ["if", "no ip ospf network", (c) => ospfOnIfs(c, (i) => (i.ospfNet = null)), "rt"],
    ["if", "ip ospf hello-interval <secs>", (c) => ospfOnIfs(c, (i) => (i.hello = c.args[0] === 10 ? null : c.args[0])), "rt"],
    ["if", "no ip ospf hello-interval", (c) => ospfOnIfs(c, (i) => (i.hello = null)), "rt"],
    ["if", "ip ospf dead-interval <secs>", (c) => ospfOnIfs(c, (i) => (i.dead = c.args[0])), "rt"],
    ["if", "no ip ospf dead-interval", (c) => ospfOnIfs(c, (i) => (i.dead = null)), "rt"],

    ["rospf", "router-id <ip>", (c) => {
      const o = c.st.ospf;
      o.cfgRid = c.args[0];
      if (o.rid === o.cfgRid) return;
      if (ospfAdj(c.st).some((n) => n.full)) c.out(['% OSPF: Reload or use "clear ip ospf process" command, for this to take effect']);
      else o.rid = o.cfgRid;
    }, "rt"],
    ["rospf", "no router-id", (c) => { c.st.ospf.cfgRid = null; }, "rt"],
    ["rospf", "network <ip> <wild> area <area>", (c) => {
      const [addr, wild, area] = c.args, o = c.st.ospf;
      const same = o.networks.find((n) => n.addr === addr && n.wild === wild);
      if (same && areaNum(same.area) !== areaNum(area)) {
        c.out(["% 同じ network がエリア " + same.area + " で設定済み。先に no network " + addr + " " + wild + " area " + same.area + " で消す（演習用の表示）"]);
        return;
      }
      if (!same) o.networks.push({ addr, wild, area });
    }, "rt"],
    ["rospf", "no network <ip> <wild> area <area>", (c) => {
      const [addr, wild, area] = c.args, o = c.st.ospf;
      const i = o.networks.findIndex((n) => n.addr === addr && n.wild === wild && areaNum(n.area) === areaNum(area));
      if (i < 0) { c.out(["% OSPF: Network " + addr + " " + wild + " area " + area + " is not configured"]); return; }
      o.networks.splice(i, 1);
    }, "rt"],
    ["rospf", "passive-interface <if>", (c) => {
      const o = c.st.ospf, k = c.args[0];
      if (o.passiveDefault) o.nonPassive = o.nonPassive.filter((x) => x !== k);
      else if (!o.passive.includes(k)) o.passive.push(k);
    }, "rt"],
    ["rospf", "no passive-interface <if>", (c) => {
      const o = c.st.ospf, k = c.args[0];
      if (o.passiveDefault) { if (!o.nonPassive.includes(k)) o.nonPassive.push(k); }
      else o.passive = o.passive.filter((x) => x !== k);
    }, "rt"],
    ["rospf", "passive-interface default", (c) => { const o = c.st.ospf; o.passiveDefault = true; o.nonPassive = []; o.passive = []; }, "rt"],
    ["rospf", "no passive-interface default", (c) => { const o = c.st.ospf; o.passiveDefault = false; o.nonPassive = []; o.passive = []; }, "rt"],
    ["rospf", "auto-cost reference-bandwidth <refbw>", (c) => {
      c.st.ospf.refbw = c.args[0];
      c.out(["% OSPF: Reference bandwidth is changed.", "        Please ensure reference bandwidth is consistent across all routers."]);
    }, "rt"],
    ["rospf", "no auto-cost reference-bandwidth", (c) => (c.st.ospf.refbw = 100), "rt"],

    ["rbgp", "bgp router-id <ip>", (c) => (c.st.bgp.rid = c.args[0]), "rt"],
    ["rbgp", "neighbor <ip> remote-as <asn>", (c) => c.st.bgp.neighbors.set(c.args[0], { remoteAs: c.args[1] }), "rt"],
    ["rbgp", "no neighbor <ip>", (c) => c.st.bgp.neighbors.delete(c.args[0]), "rt"],
    ["rbgp", "network <ip> mask <mask>", (c) => {
      const len = maskLen(c.args[1]);
      if (len == null) { c.out(["% Invalid mask"]); return; }
      const net = netOf(c.args[0], len);
      if (!c.st.bgp.networks.some((n) => n.net === net && n.len === len)) c.st.bgp.networks.push({ net, len });
    }, "rt"],
    ["rbgp", "network <ip>", (c) => {
      const len = classfulLen(c.args[0]), net = netOf(c.args[0], len);
      if (!c.st.bgp.networks.some((n) => n.net === net && n.len === len)) c.st.bgp.networks.push({ net, len });
    }, "rt"],
    ["rbgp", "no network <ip> mask <mask>", (c) => {
      const len = maskLen(c.args[1]);
      c.st.bgp.networks = c.st.bgp.networks.filter((n) => !(n.net === netOf(c.args[0], len) && n.len === len));
    }, "rt"],
    ["rbgp", "no network <ip>", (c) => {
      const len = classfulLen(c.args[0]);
      c.st.bgp.networks = c.st.bgp.networks.filter((n) => !(n.net === netOf(c.args[0], len) && n.len === len));
    }, "rt"],
  ];

  // ルータの動きから出るログ（隣接の変化、エリアの不一致、BGP の接続）
  function routerLogs(st, log) {
    if (st.ospf) st.lastPid = st.ospf.pid;
    const pid = st.lastPid;
    const now = new Map();
    ospfAdj(st).forEach((n) => {
      const key = n.k + "|" + n.p.rid;
      if (n.full) now.set(key, n);
      const ak = "area:" + n.k;
      if (n.fail === "area") {
        if (!st.warned.has(ak)) {
          log("%OSPF-4-ERRRCV: Received invalid packet: mismatched area ID" + (areaNum(n.p.area) === 0 ? " from backbone area" : ",") + " from " + n.p.ip + ", " + longIf(n.k));
          st.warned.add(ak);
        }
      } else st.warned.delete(ak);
    });
    if (st.ospfRestart) {
      st.adjUp.forEach((key) => { const [k, rid] = key.split("|"); log("%OSPF-5-ADJCHG: Process " + pid + ", Nbr " + rid + " on " + longIf(k) + " from FULL to DOWN, Neighbor Down: Interface down or detached"); });
      st.adjUp.clear();
      st.ospfRestart = false;
    }
    [...st.adjUp].forEach((key) => {
      if (now.has(key)) return;
      const [k, rid] = key.split("|");
      log("%OSPF-5-ADJCHG: Process " + pid + ", Nbr " + rid + " on " + longIf(k) + " from FULL to DOWN, Neighbor Down: Interface down or detached");
      st.adjUp.delete(key);
    });
    now.forEach((n, key) => {
      if (st.adjUp.has(key)) return;
      log("%OSPF-5-ADJCHG: Process " + pid + ", Nbr " + n.p.rid + " on " + longIf(n.k) + " from LOADING to FULL, Loading Done");
      st.adjUp.add(key);
    });
    const hex = (as) => as.toString(16).toUpperCase().padStart(4, "0");
    const est = new Set();
    bgpPeers(st).forEach((p) => {
      const nk = "bgpn:" + p.ip + ":" + p.why + ":" + p.nb.remoteAs + ":" + st.bgp.asn;
      if (p.state === "Established") est.add(p.ip);
      if (p.why && !st.warned.has(nk)) {
        if (p.why === "sent") log("%BGP-3-NOTIFICATION: sent to neighbor " + p.ip + " passive 2/2 (peer in wrong AS) 2 bytes " + hex(p.link.as));
        else log("%BGP-3-NOTIFICATION: received from neighbor " + p.ip + " active 2/2 (peer in wrong AS) 2 bytes " + hex(st.bgp.asn));
        st.warned.add(nk);
      }
    });
    est.forEach((ip) => { if (!st.bgpUp.has(ip)) { log("%BGP-5-ADJCHANGE: neighbor " + ip + " Up"); st.bgpUp.add(ip); } });
    [...st.bgpUp].forEach((ip) => { if (!est.has(ip)) { log("%BGP-5-ADJCHANGE: neighbor " + ip + " Down Neighbor deleted"); st.bgpUp.delete(ip); } });
  }

  // ---------------------------------------------------------------- コマンドの定義
  // run(c) の c: { st, args, out(lines), ctx(インタフェースの一覧) }
  function forIfs(c, fn) {
    c.st.ctx.forEach((k) => {
      fn(c.st.ifs[k], k);
      // Port-channel に入れた設定は、メンバーにも反映する
      if (k.startsWith("Po")) membersOf(c.st, k).forEach((m) => fn(c.st.ifs[m], m, true));
    });
  }
  function l2(fn) {
    return (c) => {
      const bad = c.st.ctx.find((k) => {
        const ifc = c.st.ifs[k];
        return fn.check && fn.check(ifc, c.args);
      });
      if (bad) { c.out([fn.check(c.st.ifs[bad], c.args, bad)]); return; }
      forIfs(c, (ifc, k, member) => fn(ifc, c.args, c, k, member));
    };
  }
  function dynNonegoErr(k) {
    return "Command rejected: Conflict between 'nonegotiate' and 'dynamic' status on this interface: " + k;
  }

  const SHOWS = [
    ["user priv", "show interfaces trunk", (c) => c.out(showIfTrunk(c.st))],
    ["user priv", "show interfaces <if> switchport", (c) => c.out(showSwitchport(c.st, c.args[0]))],
    ["user priv", "show vlan brief", (c) => c.out(showVlanBrief(c.st))],
    ["user priv", "show vlan", (c) => c.out(showVlanBrief(c.st))],
    ["user priv", "show etherchannel summary", (c) => c.out(showEtherchannel(c.st))],
    ["user priv", "show spanning-tree", (c) => c.out(showStp(c.st))],
    ["user priv", "show spanning-tree vlan <vlan>", (c) => c.out(showStp(c.st, c.args[0]))],
    ["priv", "show running-config", (c) => c.out(c.st.dev === "rt" ? showRunRouter(c.st) : showRun(c.st))],
    ["priv", "show running-config interface <if>", (c) => c.out(showRunIf(c.st, c.args[0]))],
  ];

  const DEFS = SHOWS.concat([
    ["user", "enable", (c) => (c.st.mode = "priv")],
    ["user", "exit", () => {}],
    ["priv", "disable", (c) => (c.st.mode = "user")],
    ["priv", "exit", (c) => (c.st.mode = "user")],
    ["priv", "configure terminal", (c) => { c.st.mode = "config"; c.out(["Enter configuration commands, one per line.  End with CNTL/Z."]); }],
    ["priv", "write memory", (c) => c.out(["Building configuration...", "[OK]"])],
    ["priv", "write", (c) => c.out(["Building configuration...", "[OK]"])],
    ["priv", "copy running-config startup-config", (c) => c.out(["Destination filename [startup-config]? ", "Building configuration...", "[OK]"])],

    ["config if vlan rospf rbgp", "end", (c) => endConfig(c)],
    ["config", "exit", (c) => endConfig(c)],
    ["if vlan rospf rbgp", "exit", (c) => { c.st.mode = "config"; c.st.ctx = null; }],
    ["config", "hostname <word>", (c) => (c.st.host = c.args[0])],
    ["config", "vlan <vlans>", (c) => {
      c.args[0].forEach((v) => { if (!c.st.vlans.has(v)) c.st.vlans.set(v, vlanName(v)); });
      c.st.mode = "vlan"; c.st.ctx = c.args[0];
    }],
    ["config", "no vlan <vlans>", (c) => {
      if (c.args[0].includes(1)) { c.out(["%Default VLAN 1 may not be deleted."]); return; }
      c.args[0].forEach((v) => c.st.vlans.delete(v));
    }],
    ["config", "interface <if>", (c) => {
      const k = c.args[0];
      if (!c.st.ifs[k]) c.st.ifs[k] = newIf();
      c.st.mode = "if"; c.st.ctx = [k]; c.st.range = false;
    }],
    ["config", "interface range <range>", (c) => {
      const ks = c.args[0];
      const missing = ks.find((k) => !c.st.ifs[k]);
      if (missing) { c.out(["% Command rejected: " + longIf(missing) + " does not exist."]); return; }
      c.st.mode = "if"; c.st.ctx = ks; c.st.range = true;
    }],
    ["config", "spanning-tree mode (pvst|rapid-pvst|mst)", (c) => (c.st.stp.mode = c.cmd.ctx.split(" ").pop())],
    ["config", "spanning-tree vlan <vlans> priority <prio>", (c) => {
      const p = c.args[1];
      if (p % 4096) {
        c.out(["% Bridge Priority must be in increments of 4096.", "% Allowed values are:",
          "  0     4096  8192  12288 16384 20480 24576 28672", "  32768 36864 40960 45056 49152 53248 57344 61440"]);
        return;
      }
      c.args[0].forEach((v) => (c.st.stp.prio[v] = p));
    }],
    ["config", "spanning-tree vlan <vlans> root (primary|secondary)", (c) => {
      const sec = c.cmd.ctx.endsWith("secondary");
      c.args[0].forEach((v) => (c.st.stp.prio[v] = rootPrimary(c.st, v, sec)));
    }],
    ["config", "no spanning-tree vlan <vlans> priority", (c) => c.args[0].forEach((v) => delete c.st.stp.prio[v])],
    ["config", "no spanning-tree vlan <vlans> root", (c) => c.args[0].forEach((v) => delete c.st.stp.prio[v])],

    ["vlan", "name <word>", (c) => c.st.ctx.forEach((v) => c.st.vlans.set(v, c.args[0]))],
    ["vlan", "no name", (c) => c.st.ctx.forEach((v) => c.st.vlans.set(v, vlanName(v)))],

    ["if", "switchport mode (access|trunk)", l2(Object.assign((ifc, a, c) => (ifc.mode = c.cmd.ctx.split(" ").pop()), {}))],
    ["if", "switchport mode dynamic (auto|desirable)", l2(Object.assign((ifc, a, c) => {
      const m = "dynamic " + c.cmd.ctx.split(" ").pop();
      ifc.mode = m === "dynamic auto" ? null : m;
    }, { check: (ifc, a, k) => ifc.nonego && dynNonegoErr(k || "") }))],
    ["if", "no switchport mode", l2((ifc) => (ifc.mode = null))],
    ["if", "switchport access vlan <vlan>", (c) => {
      const v = c.args[0];
      if (!c.st.vlans.has(v)) { c.out(["% Access VLAN does not exist. Creating vlan " + v]); c.st.vlans.set(v, vlanName(v)); }
      forIfs(c, (ifc) => (ifc.access = v));
    }],
    ["if", "no switchport access vlan", l2((ifc) => (ifc.access = 1))],
    ["if", "switchport trunk encapsulation (dot1q|negotiate)", l2((ifc, a, c) => (ifc.encap = c.cmd.ctx.split(" ").pop()))],
    ["if", "switchport trunk native vlan <vlan>", l2((ifc, a) => (ifc.native = a[0]))],
    ["if", "no switchport trunk native vlan", l2((ifc) => (ifc.native = 1))],
    ["if", "switchport trunk allowed vlan <vlans>", l2((ifc, a) => (ifc.allowed = [...a[0]]))],
    ["if", "switchport trunk allowed vlan add <vlans>", l2((ifc, a) => {
      if (ifc.allowed != null) ifc.allowed = [...new Set(ifc.allowed.concat(a[0]))].sort((x, y) => x - y);
    })],
    ["if", "switchport trunk allowed vlan remove <vlans>", l2((ifc, a) => {
      const base = ifc.allowed == null ? Array.from({ length: VLAN_MAX }, (_, i) => i + 1) : ifc.allowed;
      ifc.allowed = base.filter((v) => !a[0].includes(v));
    })],
    ["if", "switchport trunk allowed vlan except <vlans>", l2((ifc, a) => {
      ifc.allowed = Array.from({ length: VLAN_MAX }, (_, i) => i + 1).filter((v) => !a[0].includes(v));
    })],
    ["if", "switchport trunk allowed vlan all", l2((ifc) => (ifc.allowed = null))],
    ["if", "switchport trunk allowed vlan none", l2((ifc) => (ifc.allowed = []))],
    ["if", "no switchport trunk allowed vlan", l2((ifc) => (ifc.allowed = null))],
    ["if", "switchport nonegotiate", l2(Object.assign((ifc) => (ifc.nonego = true), {
      check: (ifc, a, k) => adminMode(ifc).startsWith("dynamic") && dynNonegoErr(k || ""),
    }))],
    ["if", "no switchport nonegotiate", l2((ifc) => (ifc.nonego = false))],
    ["if", "channel-group <grp> mode (active|passive|on|desirable|auto)", (c) => channelGroup(c)],
    ["if", "no channel-group", (c) => c.st.ctx.forEach((k) => { const i = c.st.ifs[k]; i.group = null; i.gmode = null; })],
    ["if", "shutdown", (c) => c.st.ctx.forEach((k) => (c.st.ifs[k].shut = true))],
    ["if", "no shutdown", (c) => c.st.ctx.forEach((k) => (c.st.ifs[k].shut = false))],
    ["if", "description <line>", (c) => c.st.ctx.forEach((k) => (c.st.ifs[k].desc = c.args[0]))],
    ["if", "no description", (c) => c.st.ctx.forEach((k) => (c.st.ifs[k].desc = ""))],
    ["if", "spanning-tree portfast", (c) => c.st.ctx.forEach((k) => (c.st.ifs[k].portfast = true))],
    ["if", "no spanning-tree portfast", (c) => c.st.ctx.forEach((k) => (c.st.ifs[k].portfast = false))],
    ["if", "spanning-tree bpduguard enable", (c) => c.st.ctx.forEach((k) => (c.st.ifs[k].bpduguard = true))],
    ["if", "no spanning-tree bpduguard", (c) => c.st.ctx.forEach((k) => (c.st.ifs[k].bpduguard = false))],
  ]);

  function endConfig(c) {
    c.st.mode = "priv";
    c.st.ctx = null;
    c.log("%SYS-5-CONFIG_I: Configured from console by console");
  }

  function channelGroup(c) {
    const st = c.st, g = c.args[0], mode = c.cmd.ctx.split(" ").pop();
    const po = st.ctx.find((k) => k.startsWith("Po"));
    if (po) { c.out(["% channel-group は物理インタフェース（GigabitEthernet）で設定します"]); return; }
    for (const k of st.ctx) {
      const others = Object.keys(st.ifs).filter((x) => x !== k && x.startsWith("Gi") && st.ifs[x].group === g);
      const clash = others.find((x) => isProto(st.ifs[x].gmode) !== isProto(mode));
      if (clash) {
        c.out(["Command rejected (Channel protocol mismatch for interface " + longIf(k) + " in group " + g + "): the interface can not be added to the channel group"]);
        continue;
      }
      const pk = "Po" + g;
      if (!st.ifs[pk]) {
        st.ifs[pk] = newIf();
        copyL2(st.ifs[k], st.ifs[pk]);
        c.out(["Creating a port-channel interface Port-channel " + g]);
      } else {
        copyL2(st.ifs[pk], st.ifs[k]);
      }
      st.ifs[k].group = g;
      st.ifs[k].gmode = mode;
    }
  }

  const CMDS = { sw: compile(DEFS, "sw"), rt: compile(DEFS.concat(ROUTER_DEFS), "rt") };
  const CONFIG_MODES = ["config", "if", "vlan", "rospf", "rbgp"];

  // ---------------------------------------------------------------- 機器の動きから出るログ
  function afterCommand(st, log) {
    if (st.dev === "rt") { routerLogs(st, log); return; }
    logicalPorts(st).forEach((k) => {
      const link = peerLink(st, k);
      if (!link || link.native == null) return;
      const key = "native:" + k;
      const mismatch = opTrunk(st, k) && st.ifs[k].native !== link.native;
      if (mismatch && !st.warned.has(key)) {
        log("%CDP-4-NATIVE_VLAN_MISMATCH: Native VLAN mismatch discovered on " + longIf(k) + " (" + st.ifs[k].native + "), with " + link.peer + " " + longIf(link.peerIf || k) + " (" + link.native + ").");
        st.warned.add(key);
      }
      if (!mismatch) st.warned.delete(key);
    });
  }

  // ---------------------------------------------------------------- 演習
  const has = (arr, list) => arr != null && arr.length === list.length && list.every((v) => arr.includes(v));

  const LABS = {
    trunk: {
      title: "トランクを設定する",
      intro:
        "<p>SW1 の <code>Gi1/0/24</code> は SW2 につながっている。<br>SW2 側は<strong>トランクに固定、ネイティブ VLAN 99、DTP は停止</strong>の設定が済んでいる。<br>SW1 には VLAN 10（SALES）と 20（DEV）だけがある。</p><p>SW1 で次のように設定しよう。</p>",
      goals: [
        "VLAN 99 を作り、名前を NATIVE にする",
        "Gi1/0/24 をトランクに固定する",
        "ネイティブ VLAN を 99 にする",
        "トランクで運ぶ VLAN を 10・20・99 だけにする",
        "DTP を止める",
      ],
      links: { "Gi1/0/24": { peer: "SW2", peerIf: "Gi1/0/24", mode: "trunk", nonego: true, native: 99 } },
      bridges: { SW2: { mac: "00a1.0000.0100" } },
      setup(st) {
        st.vlans.set(10, "SALES");
        st.vlans.set(20, "DEV");
      },
      checks: [
        ["VLAN 99 があり、名前が NATIVE", (st) => st.vlans.get(99) === "NATIVE"],
        ["Gi1/0/24 が switchport mode trunk", (st) => st.ifs["Gi1/0/24"].mode === "trunk"],
        ["ネイティブ VLAN が 99", (st) => st.ifs["Gi1/0/24"].native === 99],
        ["許可 VLAN が 10,20,99 だけ", (st) => has(st.ifs["Gi1/0/24"].allowed, [10, 20, 99])],
        ["switchport nonegotiate が入っている", (st) => st.ifs["Gi1/0/24"].nonego],
        ["show interfaces trunk で trunking になっている", (st) => opTrunk(st, "Gi1/0/24")],
      ],
      hint:
        "<p>VLAN は <code>vlan 99</code> で作り、続けて <code>name NATIVE</code>。<br>インタフェースは <code>interface g1/0/24</code> で選ぶ。<br><code>switchport nonegotiate</code> は、<strong>先に mode を trunk にしてから</strong>でないと受け付けられない（dynamic のままだと DTP を止められない）。</p>",
      answer: [
        "enable   ! 特権 EXEC モードへ",
        "configure terminal   ! 設定モードへ",
        "vlan 99   ! VLAN 99 を作る",
        " name NATIVE   ! 名前を付ける",
        "interface Gi1/0/24   ! ポートを選ぶ（省略形でよい）",
        " switchport mode trunk   ! トランクに固定",
        " switchport trunk native vlan 99   ! 相手と同じネイティブ VLAN に",
        " switchport trunk allowed vlan 10,20,99   ! 運ぶ VLAN を決める",
        " switchport nonegotiate   ! DTP を止める",
        " end   ! 特権 EXEC モードに戻る",
        "show interfaces trunk   ! trunking になったか確かめる",
      ],
    },

    etherchannel: {
      title: "LACP で EtherChannel を組む",
      intro:
        "<p>SW1 の <code>Gi1/0/1</code>・<code>Gi1/0/2</code> は SW2 につながっている。<br>SW2 側は<strong>2本を LACP の passive で Port-channel1 にまとめ、トランクにしてある</strong>。<br>SW1 には VLAN 10・20 がある。</p><p>SW1 で次のように設定しよう。</p>",
      goals: [
        "Gi1/0/1・Gi1/0/2 を LACP で束ね、Port-channel1 にする",
        "Port-channel1 をトランクに固定する",
        "トランクで運ぶ VLAN を 10・20 だけにする",
      ],
      links: {
        "Gi1/0/1": { peer: "SW2", peerIf: "Gi1/0/1", mode: "trunk", chan: "passive" },
        "Gi1/0/2": { peer: "SW2", peerIf: "Gi1/0/2", mode: "trunk", chan: "passive" },
      },
      bridges: { SW2: { mac: "00a1.0000.0100" } },
      setup(st) {
        st.vlans.set(10, "SALES");
        st.vlans.set(20, "DEV");
      },
      checks: [
        ["Gi1/0/1・Gi1/0/2 が channel-group 1 で LACP", (st) => ["Gi1/0/1", "Gi1/0/2"].every((k) => st.ifs[k].group === 1 && isProto(st.ifs[k].gmode) === "LACP")],
        ["2本とも束に入っている（P）", (st) => ["Gi1/0/1", "Gi1/0/2"].every((k) => memberFlag(st, k) === "P")],
        ["Port-channel1 が switchport mode trunk", (st) => !!st.ifs.Po1 && st.ifs.Po1.mode === "trunk"],
        ["Port-channel1 の許可 VLAN が 10,20 だけ", (st) => !!st.ifs.Po1 && has(st.ifs.Po1.allowed, [10, 20])],
        ["show etherchannel summary で Po1(SU)", (st) => !!st.ifs.Po1 && linkUp(st, "Po1")],
      ],
      hint:
        "<p>2本まとめて選ぶには <code>interface range g1/0/1 - 2</code>。<br>相手が <strong>passive</strong> なので、こちらが <strong>passive だと束ならない</strong>（どちらも誘わない）。<br>束ねたあとの設定は <code>interface port-channel 1</code> に入れると、メンバーにも反映される。</p>",
      answer: [
        "enable",
        "configure terminal",
        "interface range Gi1/0/1 - 2   ! 2本まとめて選ぶ（省略形でよい）",
        " channel-group 1 mode active   ! 相手が passive なので、こちらは active",
        "interface Port-channel1   ! 以後の設定は Port-channel 側へ",
        " switchport mode trunk   ! トランクに固定",
        " switchport trunk allowed vlan 10,20   ! 運ぶ VLAN を決める",
        " end",
        "show etherchannel summary   ! Po1(SU) と (P) を確かめる",
      ],
    },

    stp: {
      title: "ルートブリッジを決める",
      intro:
        "<p>SW1・SW2・SW3 が三角形につながっている（SW1 の <code>Gi1/0/23</code> → SW2、<code>Gi1/0/24</code> → SW3）。<br>VLAN 10 は、3台とも優先度が既定の 32768 で、<strong>MAC アドレスがいちばん小さい SW2</strong> がルートになっている。<br>VLAN 20 は、SW2 に <code>root primary</code> が設定済み（優先度 24576）で、SW2 がルートになっている。</p><p>SW1 で次のように設定しよう。</p>",
      goals: [
        "STP を Rapid PVST+ にする",
        "VLAN 10 では SW1 をルートブリッジにする",
        "VLAN 20 では SW1 を予備のルート（root secondary）にする",
      ],
      mac: "00a1.0000.0300",
      links: {
        "Gi1/0/23": { peer: "SW2", peerIf: "Gi1/0/23", mode: "trunk" },
        "Gi1/0/24": { peer: "SW3", peerIf: "Gi1/0/23", mode: "trunk" },
      },
      bridges: { SW2: { mac: "00a1.0000.0100", prio: { 20: 24576 } }, SW3: { mac: "00a1.0000.0200" } },
      setup(st) {
        st.vlans.set(10, "SALES");
        st.vlans.set(20, "DEV");
        st.ifs["Gi1/0/23"].mode = "trunk";
        st.ifs["Gi1/0/24"].mode = "trunk";
      },
      checks: [
        ["spanning-tree mode rapid-pvst", (st) => st.stp.mode === "rapid-pvst"],
        ["VLAN 10 で SW1 がルートブリッジ", (st) => { const s = stpVlan(st, 10); return !!s && s.isRoot; }],
        ["VLAN 20 の優先度が 28672（secondary）", (st) => st.stp.prio[20] === 28672],
        ["VLAN 20 のルートは SW2 のまま", (st) => { const s = stpVlan(st, 20); return !!s && s.root.name === "SW2"; }],
      ],
      hint:
        "<p><code>spanning-tree vlan 10 root primary</code> と <code>spanning-tree vlan 20 root secondary</code> を使う。<br>設定したあとに <code>show running-config</code> を見ると、<strong>root primary が priority の数字に置き換わって</strong>保存されているのが分かる。<br><code>show spanning-tree vlan 20</code> では、Gi1/0/24 の役割が変わっているかも見てみよう。</p>",
      answer: [
        "enable",
        "configure terminal",
        "spanning-tree mode rapid-pvst   ! Rapid PVST+ に",
        "spanning-tree vlan 10 root primary   ! 優先度 24576 になり、ルートになる",
        "spanning-tree vlan 20 root secondary   ! 優先度 28672（予備のルート）",
        "end",
        "show spanning-tree vlan 10   ! This bridge is the root を確かめる",
      ],
    },

    // ---------------------------------------------------------------- L3（ルータ）
    ospf: {
      title: "OSPF で隣接を作る",
      device: "router",
      intro:
        "<p>R1 の <code>Gi0/0</code>（10.0.12.1/30）は R2 につながっている。<br>R1 の <code>Gi0/1</code>（192.168.1.1/24）は PC のいる LAN、<code>Lo0</code> は 1.1.1.1/32。<br>IP アドレスは設定済み。R2 はエリア 0 で OSPF を動かしていて、ルータ ID は 2.2.2.2。</p><p>R1 で次のように設定しよう。</p>",
      goals: [
        "OSPF のプロセス 1 を作り、ルータ ID を 1.1.1.1 にする",
        "Gi0/0・Gi0/1・Lo0 をエリア 0 に入れる",
        "LAN 側の Gi0/1 には hello を送らないようにする（passive-interface）",
        "R2 と隣接ができ（FULL）、2.2.2.2 と 192.168.2.0/24 への経路が載ったことを確かめる",
      ],
      links: {
        "Gi0/0": { ospf: { rid: "2.2.2.2", ip: "10.0.12.2", area: "0", routes: [{ net: "2.2.2.2", len: 32, cost: 1 }, { net: "192.168.2.0", len: 24, cost: 1 }] } },
        "Gi0/1": { lan: true, hosts: ["192.168.1.10"] },
      },
      setup(st) {
        setIp(st, "Gi0/0", "10.0.12.1", "255.255.255.252");
        setIp(st, "Gi0/1", "192.168.1.1", "255.255.255.0");
        setIp(st, "Lo0", "1.1.1.1", "255.255.255.255");
      },
      checks: [
        ["ルータ ID が 1.1.1.1", (st) => !!st.ospf && st.ospf.rid === "1.1.1.1"],
        ["Gi0/0・Gi0/1・Lo0 がエリア 0", (st) => ["Gi0/0", "Gi0/1", "Lo0"].every((k) => { const a = ospfArea(st, k); return a && areaNum(a.area) === 0; })],
        ["Gi0/1 が passive-interface（Gi0/0 は違う）", (st) => !!st.ospf && isPassive(st, "Gi0/1") && !isPassive(st, "Gi0/0")],
        ["R2（2.2.2.2）と FULL", (st) => ospfAdj(st).some((n) => n.p.rid === "2.2.2.2" && n.full)],
        ["2.2.2.2/32 と 192.168.2.0/24 が O で載っている", (st) => ["2.2.2.2/32", "192.168.2.0/24"].every((x) => rib(st).some((r) => r.code === "O" && r.net + "/" + r.len === x))],
      ],
      hint:
        "<p>プロセスは <code>router ospf 1</code> で作る。<br>インタフェースをエリアに入れるには、<code>network 10.0.12.0 0.0.0.3 area 0</code> のように<strong>ワイルドカードマスク</strong>で書くか、インタフェースで <code>ip ospf 1 area 0</code> と書く。<br>R2 とつながる Gi0/0 を passive にすると、隣接ができなくなる。</p>",
      answer: [
        "enable",
        "configure terminal",
        "router ospf 1   ! プロセス 1 を作る（番号はこのルータの中だけの意味）",
        " router-id 1.1.1.1   ! ルータ ID を決める",
        " network 10.0.12.0 0.0.0.3 area 0   ! Gi0/0 をエリア 0 へ",
        " network 192.168.1.0 0.0.0.255 area 0   ! Gi0/1 をエリア 0 へ",
        " network 1.1.1.1 0.0.0.0 area 0   ! Lo0 をエリア 0 へ",
        " passive-interface Gi0/1   ! LAN には hello を送らない",
        " end",
        "show ip ospf neighbor   ! 2.2.2.2 が FULL になったか",
        "show ip route ospf   ! O の経路が載ったか",
      ],
    },

    "ospf-cost": {
      title: "コストで経路を選ばせる",
      device: "router",
      intro:
        "<p>R1 は、<code>Gi0/0</code>（10.0.12.1/30）で R2 と、<code>Gi0/1</code>（10.0.13.1/30）で R3 とつながっている。<br>R2 と R3 の先には、どちらにも R4 の LAN（10.4.4.0/24）がある。<br>OSPF は設定済みで、どのリンクもコストは 1。</p><p>R1 で次のことをしよう。</p>",
      goals: [
        "show ip route で、10.4.4.0/24 への経路が2本（等コスト）あることを確かめる",
        "R3 経由は予備にしたい。Gi0/1 のコストを上げて、R2 経由の1本だけが使われるようにする",
        "R3 との隣接は切らない",
      ],
      links: {
        "Gi0/0": { ospf: { rid: "2.2.2.2", ip: "10.0.12.2", area: "0", routes: [{ net: "2.2.2.2", len: 32, cost: 1 }, { net: "10.4.4.0", len: 24, cost: 2 }] } },
        "Gi0/1": { ospf: { rid: "3.3.3.3", ip: "10.0.13.2", area: "0", routes: [{ net: "3.3.3.3", len: 32, cost: 1 }, { net: "10.4.4.0", len: 24, cost: 2 }] } },
      },
      setup(st) {
        setIp(st, "Gi0/0", "10.0.12.1", "255.255.255.252");
        setIp(st, "Gi0/1", "10.0.13.1", "255.255.255.252");
        setIp(st, "Lo0", "1.1.1.1", "255.255.255.255");
        st.ospf = newOspf(st, 1);
        st.ospf.cfgRid = st.ospf.rid = "1.1.1.1";
        st.ospf.networks.push({ addr: "0.0.0.0", wild: "255.255.255.255", area: "0" });
      },
      checks: [
        ["Gi0/1 のコストが Gi0/0 より大きい", (st) => !!st.ospf && ospfCost(st, "Gi0/1") > ospfCost(st, "Gi0/0")],
        ["10.4.4.0/24 が R2（10.0.12.2）経由の1本だけ", (st) => { const r = rib(st).find((x) => x.net === "10.4.4.0" && x.len === 24); return !!r && r.via.length === 1 && r.via[0].ip === "10.0.12.2"; }],
        ["R3（3.3.3.3）とは FULL のまま", (st) => ospfAdj(st).some((n) => n.p.rid === "3.3.3.3" && n.full)],
      ],
      hint:
        "<p>経路の数字 <code>[110/3]</code> の 3 がメトリック（コストの合計）。<br>インタフェースで <code>ip ospf cost 100</code> のようにコストを直接決められる。<br>コストは<strong>出ていく側のインタフェース</strong>の値が足されるので、R1 の Gi0/1 で変える。<br><code>shutdown</code> や <code>passive-interface</code> で R3 を切るのは、予備にならないので不正解。</p>",
      answer: [
        "enable",
        "show ip route ospf   ! 10.4.4.0/24 が via 2本（[110/3]）",
        "configure terminal",
        "interface Gi0/1",
        " ip ospf cost 100   ! R3 側のコストを上げる",
        " end",
        "show ip route ospf   ! via 10.0.12.2 の1本になった",
        "show ip ospf interface brief   ! Gi0/1 の Cost が 100",
      ],
    },

    "ospf-fix": {
      title: "隣接ができない原因を探す",
      device: "router",
      intro:
        "<p>R1 の <code>Gi0/0</code>（10.0.13.1/30）は R3 につながっているが、隣接ができない（<code>show ip ospf neighbor</code> に何も出ない）。<br>R3 側の設定は正しい。R3 の Gi0/0 は 10.0.13.2/30、エリア 0、hello 10 秒・dead 40 秒で、ルータ ID は 3.3.3.3。</p><p>show コマンドで原因を見つけて、R1 側を直そう。</p>",
      goals: [
        "原因を2つ見つける",
        "直して、R3 と FULL になる",
        "3.3.3.3/32 への経路が載ったことを確かめる",
      ],
      links: {
        "Gi0/0": { ospf: { rid: "3.3.3.3", ip: "10.0.13.2", area: "0", routes: [{ net: "3.3.3.3", len: 32, cost: 1 }, { net: "192.168.3.0", len: 24, cost: 1 }] } },
      },
      setup(st) {
        setIp(st, "Gi0/0", "10.0.13.1", "255.255.255.252");
        setIp(st, "Lo0", "1.1.1.1", "255.255.255.255");
        st.ifs["Gi0/0"].hello = 5;
        st.ospf = newOspf(st, 1);
        st.ospf.cfgRid = st.ospf.rid = "1.1.1.1";
        st.ospf.networks.push({ addr: "1.1.1.1", wild: "0.0.0.0", area: "0" }, { addr: "10.0.13.0", wild: "0.0.0.3", area: "1" });
      },
      checks: [
        ["Gi0/0 がエリア 0", (st) => { const a = ospfArea(st, "Gi0/0"); return !!a && areaNum(a.area) === 0; }],
        ["Gi0/0 の hello 10 秒・dead 40 秒", (st) => helloOf(st.ifs["Gi0/0"]) === 10 && deadOf(st.ifs["Gi0/0"]) === 40],
        ["R3（3.3.3.3）と FULL", (st) => ospfAdj(st).some((n) => n.p.rid === "3.3.3.3" && n.full)],
        ["3.3.3.3/32 が載っている", (st) => rib(st).some((r) => r.code === "O" && r.net === "3.3.3.3")],
      ],
      hint:
        "<p><code>show ip ospf interface Gi0/0</code> で、<strong>エリア</strong>と <strong>Hello・Dead の秒数</strong>を R3 と比べる。<br>コマンドを打つと出てくる <code>%OSPF-4-ERRRCV</code> のログも手がかりになる。<br>network を直すときは、<code>no network …</code> で古い行を消してから入れ直す。<code>no ip ospf hello-interval</code> で hello を既定に戻すと、dead も 40 秒に戻る。</p>",
      answer: [
        "enable",
        "show ip ospf interface Gi0/0   ! Area 1、Hello 5・Dead 20 になっている",
        "configure terminal",
        "router ospf 1",
        " no network 10.0.13.0 0.0.0.3 area 1   ! 間違ったエリアの行を消す",
        " network 10.0.13.0 0.0.0.3 area 0   ! エリア 0 で入れ直す",
        "interface Gi0/0",
        " no ip ospf hello-interval   ! hello を 10 秒に戻す（dead も 40 秒に戻る）",
        " end",
        "show ip ospf neighbor   ! 3.3.3.3 が FULL になったか",
      ],
    },

    ebgp: {
      title: "eBGP で ISP とつなぐ",
      device: "router",
      intro:
        "<p>R1（AS 65001）の <code>Gi0/0</code>（203.0.113.1/30）は ISP のルータ（203.0.113.2、AS 65002）につながっている。<br>R1 の <code>Gi0/1</code> は社内の LAN（172.16.10.1/24）、<code>Lo0</code> は 1.1.1.1/32。<br>ISP 側の設定は済んでいて、デフォルトルートと 198.51.100.0/24 を送ってくる。</p><p>R1 で次のように設定しよう。</p>",
      goals: [
        "BGP を AS 65001 で動かす",
        "203.0.113.2（AS 65002）と eBGP のネイバーになる",
        "社内の LAN 172.16.10.0/24 を ISP に広告する",
        "show ip bgp summary で接続できたこと、デフォルトルートが B で載ったことを確かめる",
      ],
      links: {
        "Gi0/0": { bgp: { ip: "203.0.113.2", as: 65002, expectAs: 65001, routes: [{ net: "0.0.0.0", len: 0 }, { net: "198.51.100.0", len: 24 }] } },
        "Gi0/1": { lan: true, hosts: ["172.16.10.10"] },
      },
      setup(st) {
        setIp(st, "Gi0/0", "203.0.113.1", "255.255.255.252");
        setIp(st, "Gi0/1", "172.16.10.1", "255.255.255.0");
        setIp(st, "Lo0", "1.1.1.1", "255.255.255.255");
      },
      checks: [
        ["203.0.113.2 と Established", (st) => bgpPeers(st).some((p) => p.ip === "203.0.113.2" && p.state === "Established")],
        ["172.16.10.0/24 を広告している（BGP の表にある）", (st) => !!st.bgp && bgpLocal(st).some((n) => n.net === "172.16.10.0" && n.len === 24)],
        ["デフォルトルートが B で載っている", (st) => rib(st).some((r) => r.code === "B" && r.len === 0)],
      ],
      hint:
        "<p>ネイバーは <code>neighbor 203.0.113.2 remote-as 65002</code>（相手のアドレスと<strong>相手の</strong> AS 番号）。<br>広告は <code>network 172.16.10.0 mask 255.255.255.0</code>。<strong>mask を省くと 172.16.0.0/16（クラス B の長さ）</strong>として扱われ、ルーティングテーブルに同じ経路がないので広告されない。</p>",
      answer: [
        "enable",
        "configure terminal",
        "router bgp 65001   ! 自分の AS 番号",
        " neighbor 203.0.113.2 remote-as 65002   ! 相手のアドレスと AS 番号",
        " network 172.16.10.0 mask 255.255.255.0   ! ルーティングテーブルと同じ長さで書く",
        " end",
        "show ip bgp summary   ! State/PfxRcd に受け取った経路の数が出れば接続できている",
        "show ip bgp   ! 自分の経路（Next Hop 0.0.0.0）と ISP の経路",
        "show ip route bgp   ! B* 0.0.0.0/0 が載ったか",
      ],
    },

  };

  // ---------------------------------------------------------------- 画面
  function prompt(st) {
    if (st.pending) return st.pending.q;
    const m = { user: ">", priv: "#", config: "(config)#", if: st.range ? "(config-if-range)#" : "(config-if)#", vlan: "(config-vlan)#", rospf: "(config-router)#", rbgp: "(config-router)#" }[st.mode];
    return st.host + m;
  }

  function build(box, lab) {
    box.innerHTML = "";
    const head = el("div", "lab-head", '<span class="lab-tag">やってみる</span><b>' + esc(lab.title) + "</b>");
    const task = el("div", "lab-task", lab.intro + "<ol>" + lab.goals.map((g) => "<li>" + esc(g) + "</li>").join("") + "</ol>");
    const term = el("div", "term lab-term");
    const bar = el("div", "term-bar", "<span></span><span></span><span></span><b>" + esc(lab.host || (lab.device === "router" ? "R1" : "SW1")) + " — コンソール</b>");
    const bMax = el("button", "lab-max", "大きく表示");
    bMax.type = "button";
    bar.appendChild(bMax);
    term.appendChild(bar);
    const screen = el("div", "lab-screen");
    const out = el("div", "lab-out");
    const line = el("div", "lab-line");
    const pr = el("span", "lab-prompt");
    const input = el("input", "lab-in");
    Object.assign(input, { type: "text", spellcheck: false, autocomplete: "off" });
    input.setAttribute("autocapitalize", "off");
    input.setAttribute("autocorrect", "off");
    input.setAttribute("aria-label", "コマンドを入力");
    line.append(pr, input);
    screen.append(out, line);
    term.appendChild(screen);

    const actions = el("div", "lab-actions");
    const mk = (label, cls) => { const b = el("button", cls || "", label); b.type = "button"; actions.appendChild(b); return b; };
    const bCheck = mk("答え合わせ", "primary");
    const bHint = mk("ヒント");
    const bAns = mk("模範解答");
    const bReset = mk("最初から");
    const result = el("div", "lab-result");
    result.hidden = true;
    const hint = el("div", "callout tip lab-hint", lab.hint);
    hint.dataset.title = "ヒント";
    hint.hidden = true;
    const answer = el("div", "lab-answer");
    answer.hidden = true;
    const pre = el("pre");
    pre.dataset.cli = "config";
    pre.dataset.title = "模範解答";
    pre.textContent = lab.answer.join("\n");
    answer.appendChild(pre);

    // 左の欄（課題・ボタン・結果）。ふだんは中身がそのまま並び、作業画面では左に1列でまとまる
    const side = el("div", "lab-side");
    side.append(head, task, actions, result, hint, answer);
    // 作業画面で左右（狭い画面では上下）の比率を変える仕切り
    const split = el("div", "lab-split");
    split.tabIndex = 0;
    split.setAttribute("role", "separator");
    split.title = "ドラッグで幅を変える（ダブルクリックで元に戻す）";
    box.append(side, split, term);

    let st, hist = [], hi = 0;

    function print(text, cls) {
      const d = el("div", cls || "");
      d.textContent = text === "" ? " " : text;
      out.appendChild(d);
    }
    function echo(text) {
      const d = el("div");
      d.appendChild(el("span", "lab-p", esc(prompt(st))));
      d.appendChild(document.createTextNode(text));
      out.appendChild(d);
    }
    function scroll() { screen.scrollTop = screen.scrollHeight; }
    function refresh() { pr.textContent = prompt(st); }

    function reset() {
      st = newState(lab);
      out.innerHTML = "";
      print("! ? で次に打てる候補、Tab で補完、↑↓ で前に打ったコマンド。省略形（conf t、" + (st.dev === "rt" ? "int g0/0、sh ip ro" : "int g1/0/24") + "、sh run）も使える", "lab-muted");
      print("");
      refresh();
      result.hidden = true;
    }

    function ctxFor(line) {
      const tokens = tokenize(line);
      let mode = st.mode, offset = 0;
      if (CONFIG_MODES.includes(mode) && tokens.length && tokens[0].t.toLowerCase() === "do") {
        tokens.shift();
        mode = "priv";
        offset = 1;
      }
      return { tokens, mode, offset };
    }

    function run(raw) {
      curSt = st;
      echo(raw);
      // 「[no]: 」のような確認への答え
      if (st.pending) {
        const p = st.pending;
        st.pending = null;
        if (/^y(es)?$/i.test(raw.trim())) {
          p.fn();
          const logs = [];
          afterCommand(st, (m) => logs.push(m));
          logs.forEach((m) => print(m, "lab-log"));
        }
        refresh();
        scroll();
        return;
      }
      const text = raw.trim();
      if (text) { hist.push(raw); }
      hi = hist.length;
      if (!text) { scroll(); return; }
      const { tokens, mode } = ctxFor(raw);
      const T = CMDS[st.dev];
      let r = matchCmd(tokens, T[mode] || []);
      // サブモードで通らないコマンドは、1つ上の設定モードで試す（IOS と同じ動き）
      if (r.error === "invalid" && ["if", "vlan", "rospf", "rbgp"].includes(mode)) {
        const r2 = matchCmd(tokens, T.config);
        if (r2.ok) { st.mode = "config"; st.ctx = null; r = r2; }
      }
      if (r.error === "invalid" || r.error === "ambiguous") {
        if (r.error === "ambiguous") print('% Ambiguous command:  "' + text + '"');
        else {
          print(" ".repeat(prompt(st).length + tokens[r.at].off) + "^");
          print("% Invalid input detected at '^' marker.");
        }
        print("");
      } else if (r.error === "incomplete") {
        print("% Incomplete command.");
        print("");
      } else {
        const logs = [];
        r.cmd.run({ st, args: r.args, cmd: r.cmd, out: (lines) => lines.forEach((l) => print(l)), log: (m) => logs.push(m), confirm: (q, fn) => (st.pending = { q, fn }) });
        afterCommand(st, (m) => logs.push(m));
        logs.forEach((m) => print(m, "lab-log"));
      }
      refresh();
      scroll();
    }

    function help(raw) {
      curSt = st;
      echo(raw + "?");
      const partialMatch = raw.match(/(\S*)$/);
      const partial = /\s$/.test(raw) || !raw ? "" : partialMatch[1];
      const before = raw.slice(0, raw.length - partial.length);
      const { tokens, mode } = ctxFor(before);
      const w = walk(tokens, CMDS[st.dev][mode] || []);
      if (w.error) {
        if (w.error === "invalid") {
          print(" ".repeat(prompt(st).length + tokens[w.at].off) + "^");
          print("% Invalid input detected at '^' marker.");
        } else print('% Ambiguous command:  "' + raw.trim() + '"');
      } else {
        const opts = new Map();
        let cr = false;
        const inChannel = tokens.length && /^ch/i.test(tokens[0].t);
        w.alive.forEach((e) => {
          if (e.done) return;
          const pt = e.c.toks[e.k];
          if (!pt) { cr = true; return; }
          if (pt.kw) {
            if (pt.kw.startsWith(partial.toLowerCase())) opts.set(pt.kw, (inChannel && KW_CHANNEL[pt.kw]) || KW[pt.kw] || "");
          } else if (!partial) {
            opts.set(ARGS[pt.arg].help, ARGS[pt.arg].desc);
          }
        });
        if (w.consumedAll) cr = true;
        if (partial) {
          if (opts.size) print([...opts.keys()].sort().join("  "));
          else print("% Unrecognized command");
        } else {
          const rows = [...opts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
          if (cr) rows.push(["<cr>", ""]);
          const wdt = Math.max(0, ...rows.map((r) => r[0].length));
          rows.forEach(([k, d]) => print("  " + pad(k, wdt) + "  " + d));
          if (!rows.length) print("% Unrecognized command");
        }
      }
      print("");
      input.value = raw;
      scroll();
    }

    function complete() {
      curSt = st;
      const raw = input.value;
      const partial = /\s$/.test(raw) || !raw ? "" : raw.match(/(\S*)$/)[1];
      if (!partial) return;
      const before = raw.slice(0, raw.length - partial.length);
      const { tokens, mode } = ctxFor(before);
      const w = walk(tokens, CMDS[st.dev][mode] || []);
      if (w.error) return;
      const kws = new Set();
      let ifArg = false;
      w.alive.forEach((e) => {
        const pt = !e.done && e.c.toks[e.k];
        if (!pt) return;
        if (pt.kw && pt.kw.startsWith(partial.toLowerCase())) kws.add(pt.kw);
        if (pt.arg === "if" || pt.arg === "range") ifArg = true;
      });
      if (kws.size === 1) input.value = before + [...kws][0] + " ";
      else if (!kws.size && ifArg && /^[a-z-]+$/i.test(partial)) {
        const T = ifType(partial);
        if (T) input.value = before + T.long;
      }
    }

    input.addEventListener("keydown", (e) => {
      if (e.isComposing) return;
      if (e.key === "Enter") { e.preventDefault(); const v = input.value; input.value = ""; run(v); }
      else if (e.key === "Tab") { e.preventDefault(); complete(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); if (hi > 0) { hi--; input.value = hist[hi]; } }
      else if (e.key === "ArrowDown") { e.preventDefault(); if (hi < hist.length) { hi++; input.value = hist[hi] || ""; } }
      else if (e.key.toLowerCase() === "z" && e.ctrlKey) {
        e.preventDefault();
        if (CONFIG_MODES.includes(st.mode)) {
          echo(input.value + "^Z");
          input.value = "";
          const logs = [];
          endConfig({ st, log: (m) => logs.push(m) });
          logs.forEach((m) => print(m, "lab-log"));
          refresh();
          scroll();
        }
      }
    });
    // ? は Enter を待たずに候補を出す（スマホのキーボードでも動くよう、入力された文字で見る）
    input.addEventListener("input", () => {
      const v = input.value;
      const i = v.indexOf("?");
      if (i >= 0) help(v.slice(0, i));
    });
    screen.addEventListener("click", () => {
      if (!String(window.getSelection())) input.focus({ preventScroll: true });
    });

    bCheck.addEventListener("click", () => {
      const rows = lab.checks.map(([label, fn]) => {
        let ok = false;
        try { ok = !!fn(st); } catch (_) { ok = false; }
        return { label, ok };
      });
      const all = rows.every((r) => r.ok);
      result.innerHTML =
        '<p class="lab-sum ' + (all ? "ok" : "ng") + '">' + (all ? "すべてできています" : "まだできていないところがあります") + "</p><ul>" +
        rows.map((r) => '<li class="' + (r.ok ? "ok" : "ng") + '">' + esc(r.label) + "</li>").join("") + "</ul>";
      result.hidden = false;
    });
    bHint.addEventListener("click", () => {
      hint.hidden = !hint.hidden;
      bHint.classList.toggle("on", !hint.hidden);
    });
    bAns.addEventListener("click", () => {
      answer.hidden = !answer.hidden;
      bAns.classList.toggle("on", !answer.hidden);
    });
    bReset.addEventListener("click", () => { reset(); input.focus({ preventScroll: true }); });

    // 大きく表示: いまのページの上に、左に課題・右に大きな端末の窓を重ねて出す（後ろは暗くする）
    let holder = null, backdrop = null;
    function setFull(on) {
      if (on === box.classList.contains("lab-full")) return;
      if (on) {
        holder = el("div", "lab-holder");
        holder.style.height = box.offsetHeight + "px";
        box.before(holder);
        loadSize();
        box.classList.add("lab-full");
        backdrop = el("div", "lab-backdrop");
        backdrop.addEventListener("click", () => setFull(false));
        document.body.appendChild(backdrop);
        document.documentElement.classList.add("lab-open");
        document.addEventListener("keydown", onEsc);
      } else {
        box.classList.remove("lab-full");
        document.documentElement.classList.remove("lab-open");
        document.removeEventListener("keydown", onEsc);
        if (holder) { holder.remove(); holder = null; }
        if (backdrop) { backdrop.remove(); backdrop = null; }
        term.scrollIntoView({ block: "nearest" });
      }
      bMax.textContent = on ? "閉じる（Esc）" : "大きく表示";
      scroll();
      input.focus({ preventScroll: true });
    }
    // ---- 仕切り: ドラッグ・矢印キーで比率を変え、ブラウザに覚えておく
    const narrow = () => window.matchMedia("(max-width: 720px)").matches;
    const SIZE_KEY = { w: "cliLabSideW", h: "cliLabSideH" };
    function loadSize() {
      split.setAttribute("aria-orientation", narrow() ? "horizontal" : "vertical");
      ["w", "h"].forEach((d) => {
        let v = null;
        try { v = localStorage.getItem(SIZE_KEY[d]); } catch (_) {}
        if (v) box.style.setProperty("--side-" + d, v + "px");
        else box.style.removeProperty("--side-" + d);
      });
    }
    function setSize(px, save) {
      const n = narrow(), d = n ? "h" : "w";
      // px は画面の座標。窓の端からの長さに直す
      const r = box.getBoundingClientRect();
      const size = n ? px - r.top : px - r.left;
      const max = n ? r.height - 140 : r.width - 328;
      const v = Math.round(Math.max(n ? 100 : 240, Math.min(max, size)));
      box.style.setProperty("--side-" + d, v + "px");
      if (save) { try { localStorage.setItem(SIZE_KEY[d], v); } catch (_) {} }
      scroll();
    }

    split.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      split.setPointerCapture(e.pointerId);
      split.classList.add("drag");
      const move = (ev) => setSize(narrow() ? ev.clientY : ev.clientX, false);
      const up = (ev) => {
        split.releasePointerCapture(ev.pointerId);
        split.classList.remove("drag");
        split.removeEventListener("pointermove", move);
        split.removeEventListener("pointerup", up);
        split.removeEventListener("pointercancel", up);
        setSize(narrow() ? ev.clientY : ev.clientX, true);
      };
      split.addEventListener("pointermove", move);
      split.addEventListener("pointerup", up);
      split.addEventListener("pointercancel", up);
    });
    split.addEventListener("dblclick", () => {
      const d = narrow() ? "h" : "w";
      try { localStorage.removeItem(SIZE_KEY[d]); } catch (_) {}
      box.style.removeProperty("--side-" + d);
    });
    split.addEventListener("keydown", (e) => {
      const n = narrow();
      const step = (n ? ["ArrowUp", "ArrowDown"] : ["ArrowLeft", "ArrowRight"]).indexOf(e.key);
      if (step < 0) return;
      e.preventDefault();
      const r = side.getBoundingClientRect();
      setSize((n ? r.bottom : r.right) + (step ? 40 : -40), true);
    });

    function onEsc(e) { if (e.key === "Escape") { e.preventDefault(); setFull(false); } }
    bMax.addEventListener("click", (e) => { e.stopPropagation(); setFull(!box.classList.contains("lab-full")); });

    reset();
  }

  window.DocCliLab = {
    init(root) {
      root.querySelectorAll("div.cli-lab[data-lab]").forEach((box) => {
        if (box.dataset.ready) return;
        const lab = LABS[box.dataset.lab];
        if (!lab) { box.textContent = "演習「" + box.dataset.lab + "」は見つかりません"; return; }
        box.dataset.ready = "1";
        build(box, lab);
      });
    },
    // 試験用（ブラウザのコンソールから動きを確かめる）
    _test: { LABS, newState, matchCmd, tokenize, CMDS, rib, ospfAdj, bgpPeers },
  };
})();
