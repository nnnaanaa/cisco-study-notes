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
  // 内部では "Gi1/0/5" と "Po1" で持つ
  function parseIf(text) {
    const m = String(text).replace(/\s+/g, "").match(/^([a-z-]+?)(\d+(?:\/\d+)*)$/i);
    if (!m) return null;
    const t = m[1].toLowerCase();
    if ("gigabitethernet".startsWith(t)) {
      const n = m[2].match(/^1\/0\/(\d+)$/);
      if (!n || +n[1] < 1 || +n[1] > PORTS) return null;
      return "Gi1/0/" + +n[1];
    }
    if (t.length >= 2 && "port-channel".startsWith(t)) {
      if (!/^\d+$/.test(m[2]) || +m[2] < 1 || +m[2] > 128) return null;
      return "Po" + +m[2];
    }
    return null;
  }
  const longIf = (k) => (k.startsWith("Gi") ? "GigabitEthernet" + k.slice(2) : "Port-channel" + k.slice(2));
  const ifNum = (k) => +k.split("/").pop().replace(/\D/g, "");
  function ifSort(a, b) {
    const pa = a.startsWith("Po") ? 0 : 1, pb = b.startsWith("Po") ? 0 : 1;
    return pa - pb || ifNum(a) - ifNum(b);
  }
  function isIfTypePrefix(w) {
    const t = w.toLowerCase();
    return (t.length >= 1 && "gigabitethernet".startsWith(t)) || (t.length >= 2 && "port-channel".startsWith(t));
  }

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
    if: { help: "<interface>", desc: "GigabitEthernet1/0/1-24、Port-channel1-128", parse: parseIf },
    range: { help: "<range>", desc: "例: GigabitEthernet1/0/1 - 2", rest: true, parse: parseRange },
    word: { help: "WORD", desc: "名前", parse: (t) => (/^[\w.-]{1,32}$/.test(t) ? t : null) },
    line: { help: "LINE", desc: "説明の文字列", rest: true, parse: (t) => t },
    grp: { help: "<1-128>", desc: "チャネルグループの番号", parse: (t) => (/^\d+$/.test(t) && +t >= 1 && +t <= 128 ? +t : null) },
    prio: { help: "<0-61440>", desc: "ブリッジの優先度（4096 の倍数）", parse: (t) => (/^\d+$/.test(t) && +t <= 61440 ? +t : null) },
  };

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
    description: "説明を付ける", portfast: "すぐ転送を始める（PC 向け）", bpduguard: "BPDU を受けたら止める", priority: "ブリッジの優先度",
    root: "ルートブリッジにする", primary: "ルートにする（24576）", secondary: "予備のルートにする（28672）",
    pvst: "PVST+", "rapid-pvst": "Rapid PVST+", mst: "MST",
  };
  // EtherChannel の desirable / auto は PAgP の意味になる
  const KW_CHANNEL = { desirable: "PAgP で自分から誘う", auto: "PAgP で誘われたら応じる", on: "ネゴシエーションせずに束ねる" };

  // "switchport mode (access|trunk)" のような書き方を、1本ずつの並びに展開する
  function expand(spec) {
    const m = spec.match(/\(([^()]*)\)/);
    if (!m) return [spec];
    return m[1].split("|").flatMap((alt) => expand(spec.replace(m[0], alt)));
  }
  function compile(defs) {
    const out = {};
    defs.forEach(([modes, spec, run]) => {
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
    return { mode: null, access: 1, native: 1, allowed: null, nonego: false, encap: null, group: null, gmode: null, shut: false, desc: "", portfast: false, bpduguard: false };
  }
  const L2KEYS = ["mode", "access", "native", "allowed", "nonego", "encap"];
  function copyL2(from, to) {
    L2KEYS.forEach((k) => (to[k] = Array.isArray(from[k]) ? [...from[k]] : from[k]));
  }
  function sameL2(a, b) {
    return L2KEYS.every((k) => JSON.stringify(a[k]) === JSON.stringify(b[k]));
  }

  function newState(lab) {
    const st = {
      host: "SW1",
      mode: "user",
      ctx: null,
      vlans: new Map([[1, "default"]]),
      ifs: {},
      stp: { mode: "pvst", prio: {} },
      mac: lab.mac || "00a1.0000.0300",
      links: lab.links || {},
      bridges: lab.bridges || {},
      warned: new Set(),
    };
    for (let i = 1; i <= PORTS; i++) st.ifs["Gi1/0/" + i] = newIf();
    if (lab.setup) lab.setup(st);
    return st;
  }

  const adminMode = (ifc) => ifc.mode || "dynamic auto";
  const isProto = (m) => (m === "active" || m === "passive" ? "LACP" : m === "desirable" || m === "auto" ? "PAgP" : "-");

  function linkUp(st, k) {
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
      for (let i = 0; i < ports.length; i += 4) {
        out.push((i === 0 ? head : " ".repeat(48)) + ports.slice(i, i + 4).join(", ") + (i + 4 < ports.length ? "," : ""));
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
    return withHeader(["!", ...ifConfigLines(st, k), "end"]);
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
    ["priv", "show running-config", (c) => c.out(showRun(c.st))],
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

    ["config if vlan", "end", (c) => endConfig(c)],
    ["config", "exit", (c) => endConfig(c)],
    ["if vlan", "exit", (c) => { c.st.mode = "config"; c.st.ctx = null; }],
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

  const CMDS = compile(DEFS);
  CMDS["if"] = CMDS["if"] || [];

  // ---------------------------------------------------------------- 機器の動きから出るログ
  function afterCommand(st, log) {
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
        "<p>SW1 の <code>Gi1/0/24</code> は SW2 につながっている。SW2 側は<strong>トランクに固定、ネイティブ VLAN 99、DTP は停止</strong>の設定が済んでいる。SW1 には VLAN 10（SALES）と 20（DEV）だけがある。SW1 で次のように設定しよう。</p>",
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
        "<p>VLAN は <code>vlan 99</code> で作り、続けて <code>name NATIVE</code>。インタフェースは <code>interface g1/0/24</code> で選ぶ。<code>switchport nonegotiate</code> は、<strong>先に mode を trunk にしてから</strong>でないと受け付けられない（dynamic のままだと DTP を止められない）。</p>",
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
        "<p>SW1 の <code>Gi1/0/1</code>・<code>Gi1/0/2</code> は SW2 につながっている。SW2 側は<strong>2本を LACP の passive で Port-channel1 にまとめ、トランクにしてある</strong>。SW1 には VLAN 10・20 がある。SW1 で次のように設定しよう。</p>",
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
        "<p>2本まとめて選ぶには <code>interface range g1/0/1 - 2</code>。相手が <strong>passive</strong> なので、こちらが <strong>passive だと束ならない</strong>（どちらも誘わない）。束ねたあとの設定は <code>interface port-channel 1</code> に入れると、メンバーにも反映される。</p>",
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
        "<p>SW1・SW2・SW3 が三角形につながっている（SW1 の <code>Gi1/0/23</code> → SW2、<code>Gi1/0/24</code> → SW3）。VLAN 10 は3台とも優先度が既定の 32768 で、<strong>MAC アドレスがいちばん小さい SW2</strong> がルートになっている。VLAN 20 は、SW2 に <code>root primary</code> が設定済み（優先度 24576）で、SW2 がルート。SW1 で次のように設定しよう。</p>",
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
        "<p><code>spanning-tree vlan 10 root primary</code> と <code>spanning-tree vlan 20 root secondary</code> を使う。設定したあとに <code>show running-config</code> を見ると、<strong>root primary が priority の数字に置き換わって</strong>保存されているのが分かる。<code>show spanning-tree vlan 20</code> では、Gi1/0/24 の役割が変わっているかも見てみよう。</p>",
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
  };

  // ---------------------------------------------------------------- 画面
  function prompt(st) {
    const m = { user: ">", priv: "#", config: "(config)#", if: st.range ? "(config-if-range)#" : "(config-if)#", vlan: "(config-vlan)#" }[st.mode];
    return st.host + m;
  }

  function build(box, lab) {
    box.innerHTML = "";
    const head = el("div", "lab-head", '<span class="lab-tag">やってみる</span><b>' + esc(lab.title) + "</b>");
    const task = el("div", "lab-task", lab.intro + "<ol>" + lab.goals.map((g) => "<li>" + esc(g) + "</li>").join("") + "</ol>");
    const term = el("div", "term lab-term");
    term.appendChild(el("div", "term-bar", "<span></span><span></span><span></span><b>SW1 — コンソール</b>"));
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

    box.append(head, task, term, actions, result, hint, answer);

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
      print("! ? で次に打てる候補、Tab で補完、↑↓ で前に打ったコマンド。省略形（conf t、int g1/0/24、sh run）も使える", "lab-muted");
      print("");
      refresh();
      result.hidden = true;
    }

    function ctxFor(line) {
      const tokens = tokenize(line);
      let mode = st.mode, offset = 0;
      if (["config", "if", "vlan"].includes(mode) && tokens.length && tokens[0].t.toLowerCase() === "do") {
        tokens.shift();
        mode = "priv";
        offset = 1;
      }
      return { tokens, mode, offset };
    }

    function run(raw) {
      echo(raw);
      const text = raw.trim();
      if (text) { hist.push(raw); }
      hi = hist.length;
      if (!text) { scroll(); return; }
      const { tokens, mode } = ctxFor(raw);
      let r = matchCmd(tokens, CMDS[mode] || []);
      // サブモードで通らないコマンドは、1つ上の設定モードで試す（IOS と同じ動き）
      if (r.error === "invalid" && (mode === "if" || mode === "vlan")) {
        const r2 = matchCmd(tokens, CMDS.config);
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
        r.cmd.run({ st, args: r.args, cmd: r.cmd, out: (lines) => lines.forEach((l) => print(l)), log: (m) => logs.push(m) });
        afterCommand(st, (m) => logs.push(m));
        logs.forEach((m) => print(m, "lab-log"));
      }
      refresh();
      scroll();
    }

    function help(raw) {
      echo(raw + "?");
      const partialMatch = raw.match(/(\S*)$/);
      const partial = /\s$/.test(raw) || !raw ? "" : partialMatch[1];
      const before = raw.slice(0, raw.length - partial.length);
      const { tokens, mode } = ctxFor(before);
      const w = walk(tokens, CMDS[mode] || []);
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
      const raw = input.value;
      const partial = /\s$/.test(raw) || !raw ? "" : raw.match(/(\S*)$/)[1];
      if (!partial) return;
      const before = raw.slice(0, raw.length - partial.length);
      const { tokens, mode } = ctxFor(before);
      const w = walk(tokens, CMDS[mode] || []);
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
        const t = partial.toLowerCase();
        if ("gigabitethernet".startsWith(t)) input.value = before + "GigabitEthernet";
        else if (t.length >= 2 && "port-channel".startsWith(t)) input.value = before + "Port-channel";
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
        if (["config", "if", "vlan"].includes(st.mode)) {
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
    _test: { LABS, newState, matchCmd, tokenize, CMDS },
  };
})();
