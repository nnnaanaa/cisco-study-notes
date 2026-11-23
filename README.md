# Cisco Study Notes

A static site for reading Cisco certification study notes (CCNP and others) comfortably in the browser. It currently holds notes for **CCNP Enterprise (ENCOR)**. The notes themselves are written in Japanese.

- Site: https://nnnaanaa.github.io/cisco-study-notes/
- Notes: [ccnp/](ccnp/)

## Adding a note

1. Add an `.html` (or `.md`) file, e.g. `ccnp/encor/02-l3.html`
2. Add one line to `DOC_FILES` in [docs.js](docs.js)

```js
doc("ccnp/encor/02-l3.html", "L3", "EIGRP and OSPF on Cisco devices"),
```

- No build step. Pushing to `main` deploys to GitHub Pages.
- To preview locally, serve the folder over HTTP (e.g. `python -m http.server`). Opening it via `file://` does not work.

## Writing HTML notes

An HTML note contains **only the body**: no `<html>` or `<head>`, and it starts with an `<h1>` title. The viewer loads it into the page, so navigation, search, the table of contents, dark mode and printing all work as usual. `<h2>` and `<h3>` headings make up the table of contents.

Certain classes and data attributes turn into interactive components when the page is rendered ([js/components.js](js/components.js), [css/components.css](css/components.css)).

| Component | Markup |
| --- | --- |
| Tags under the title | `<div class="chips"><span class="chip">802.1Q</span></div>` |
| Callout | `<div class="callout warning"><p>…</p></div>` (`note`, `tip`, `important`, `warning`, `caution`) |
| Figure | `<figure class="fig"><svg>…</svg></figure>`. Inside the SVG you can use classes such as `sw` (switch), `pc`, `t` (text), `s` (small text), `fwd` (forwarding), `blk` (blocking) and `trunk`. Wrap two figures in `<div class="fig-row">` to place them side by side |
| Annotated config | `<pre data-cli="config" data-title="SW1">`, with `  ! note` at the end of a line. Commands and notes are shown in two columns, with a "copy commands only" button |
| Device output | `<pre data-cli="show" data-title="show …">`. Hovering a `<span data-tip="note">…</span>` inside it shows the note |
| Tooltip | `<span data-tip="note">…</span>` anywhere |
| Tabs | `<div class="tabs"><div data-tab="L2">…</div><div data-tab="L3">…</div></div>` |
| Mode combination table | `<div class="combo" data-combo="etherchannel"></div>` (`etherchannel`, `dtp`) |
| Bridge ID calculator | `<div class="bid-calc"></div>` |
| Troubleshooting step | `<details class="step"><summary>Symptom</summary><dl><dt>Check</dt><dd>…</dd>…</dl></details>` |
| Flashcards | `<div class="flashcards"><div class="fc"><div class="fc-q">Question</div><div class="fc-a">Answer</div></div></div>` |
| CLI lab | `<div class="cli-lab" data-lab="trunk"></div>`. A small IOS-like simulator where you type commands and check your answer. Each lab (task, initial state, neighbor devices, checks, model answer) is defined in `LABS` in [js/cli-lab.js](js/cli-lab.js); the available labs are `trunk`, `etherchannel` and `stp`. Supported commands are defined in `DEFS` in the same file |
| Two columns | `<div class="two">…</div>` |

Markdown notes (`.md`) are still supported.
