// Checks: the folder's own checks, run from a panel, with their output kept as evidence, and a
// button that hands the result to the team's reviewer.
//   { "id": "checks", "type": "block", "content": { "mod": "checks" } }
// The checks live with the work, in <folder>/herdr-checks.json:
//   { "checks": [ { "name": "Tests", "run": "python -m pytest -q" } ] }
// Each `run` is one shell line (PowerShell on Windows, sh elsewhere), started in that folder
// only when you press Run. Exit code 0 passes. "Ask reviewer" sends the results to the pane
// labelled team.role=reviewer (Team Pane) in the shown tab, with `hc send`.
// Key commands while the panel shows: checks.run (all of them), checks.review.
import { View, div } from "gpui-kit";
import { v_flex, h_flex, Editor, EditorState } from "gpui-base";
import { spaces, panes, focused, terminals, exec, hc, readTextFile, writeTextFile, theme, settings, window, checking, notify, nextCommand } from "herdr";

const FILE = "herdr-checks.json";
const EXAMPLE = JSON.stringify({ checks: [
  { name: "No whitespace errors or conflict markers", run: "git diff --check" },
  { name: "Tests", run: "python -m pytest -q" },
] }, null, 2) + "\n";

function location() {
  const space = spaces().find((s) => s.active), f = focused();
  const pane = f?.pane ? panes().find((p) => p.pane === f.pane) : null;
  const on = f?.pane === null ? (f.terminal?.includes("/") ? f.terminal.split("/")[0] : null) : space?.machine ?? null;
  return { cwd: pane?.cwd || f?.cwd || space?.folder || null, on };
}

async function shell(line, cwd, on) {
  const windows = () => exec("powershell", ["-NoProfile", "-Command",
    "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); & { " + line + " }; $ok = $?; if ($LASTEXITCODE) { exit $LASTEXITCODE }; if (-not $ok) { exit 1 }"], { cwd, on, timeout: 600000 });
  if (!on && window()?.platform === "windows") return windows();
  try { return await exec("sh", ["-c", line], { cwd, on, timeout: 600000 }); }
  catch (e) {
    if (on && String(e).includes("cannot start sh")) return windows();
    throw e;
  }
}

const reviewer = () => {
  const shown = panes().map((p) => p.terminal).filter(Boolean);
  return terminals().find((t) => shown.includes(t.address) && /review/i.test(t.labels?.["team.role"] ?? ""))?.address ?? null;
};

export default class Checks extends View {
  init(_props, cx) {
    this.checks = []; this.results = new Map(); this.kept = new Map(); this.selected = null; this.missing = false;
    if (checking()) return;
    this.load(cx);
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        if (c === "run") this.runAll(cx);
        else if (c === "review") this.askReviewer();
        cx.notify();
      }
    });
  }

  load(cx) {
    const { cwd, on } = location();
    if (cwd !== this.root || on !== this.on) {
      if (this.root) this.kept.set(this.root, this.results);
      this.root = cwd; this.on = on; this.checks = []; this.results = this.kept.get(cwd) ?? new Map(); this.select(null); this.error = null; this.missing = false;
    }
    if (!cwd) return;
    cx.spawn(async (cx) => {
      try {
        const text = await readTextFile(`${cwd}/${FILE}`, { on }).catch(() => null);
        if (this.root !== cwd) return;
        this.missing = text === null; this.error = null;
        if (text === null) { this.checks = []; return; }
        const data = JSON.parse(text), list = Array.isArray(data) ? data : data.checks;
        if (!Array.isArray(list)) throw new Error(`${FILE}: expected { "checks": [ { "name", "run" } ] }`);
        this.checks = list.filter((c) => c && typeof c.name === "string" && typeof c.run === "string").slice(0, 30);
      } catch (e) { if (this.root === cwd) { this.checks = []; this.error = String(e.message ?? e); } }
      finally { cx.notify(); }
    });
  }

  select(name) {
    this.output?.release(); this.output = null; this.selected = name;
    const r = name ? this.results.get(name) : null;
    if (!r || r.state === "running") return;
    this.output = EditorState.new({ language: "txt", readonly: true, value: `$ ${r.run}\n${r.output || "(no output)"}\n\nexit ${r.code} · ${r.seconds}s`,
      font_family: settings().font_family, font_size: 12 });
  }

  runCheck(check, cx) {
    const root = this.root, on = this.on, results = this.results;
    if (results.get(check.name)?.state === "running") return Promise.resolve();
    results.set(check.name, { state: "running", run: check.run });
    if (this.selected === check.name) this.select(check.name);
    cx.notify();
    return new Promise((done) => cx.spawn(async (cx) => {
      const began = Date.now();
      let code = -1, output = "";
      try {
        const r = await shell(check.run, root, on);
        code = r.code; output = (r.stdout + (r.stderr ? "\n" + r.stderr : "")).trim();
      } catch (e) { output = String(e.message ?? e); }
      if (output.length > 60000) output = "… (start cut)\n" + output.slice(-60000);
      results.set(check.name, { state: code === 0 ? "pass" : "fail", run: check.run, code, output, seconds: Math.round((Date.now() - began) / 100) / 10 });
      if (this.results === results && (this.selected === check.name || (code !== 0 && !this.selected))) this.select(check.name);
      cx.notify();
      done();
    }));
  }

  // One after another: checks often share a build folder or a port.
  runAll(cx) {
    const list = [...this.checks];
    cx.spawn(async (cx) => { for (const check of list) { if (this.checks.includes(check)) await this.runCheck(check, cx); } });
  }

  create(cx) {
    const path = `${this.root}/${FILE}`;
    writeTextFile(path, EXAMPLE, null).then(() => notify({ title: "Checks", body: `Wrote ${FILE}. Edit it, or ask an agent to fill it in.` }),
      (e) => notify({ title: "Checks", body: String(e), level: "error" }));
    cx.timer.after(400, (cx) => this.load(cx));
  }

  askReviewer() {
    const to = reviewer();
    if (!to) return notify({ title: "Checks", body: "No pane with a reviewer role in this tab. Label one with Team Pane (role: reviewer).", level: "error" });
    const lines = this.checks.map((c) => {
      const r = this.results.get(c.name);
      return `- ${c.name} (${c.run}): ${!r ? "not run" : r.state === "running" ? "running" : r.state === "pass" ? "passed" : `FAILED, exit ${r.code}`}`;
    });
    const failed = this.checks.map((c) => this.results.get(c.name)).filter((r) => r?.state === "fail");
    const tail = failed.map((r) => `Output of "${r.run}" (last lines): ${r.output.split("\n").slice(-12).join(" | ")}`);
    const text = ["Please review the current changes in this folder (git status, git diff) and report findings. Do not edit files.",
      lines.length ? "Check results: " + lines.join(" ") : "No checks are set up yet.", ...tail].join(" ").replace(/\s+/g, " ").slice(0, 3000);
    hc(["send", to, text]).then((r) => notify(r.code === 0 ? { title: "Checks", body: `Sent to the reviewer (${to})` } : { title: "Checks", body: r.stderr.trim() || "hc send failed", level: "error" }),
      (e) => notify({ title: "Checks", body: String(e), level: "error" }));
  }

  render(cx) {
    const now = location();
    if (!checking() && (now.cwd !== this.root || now.on !== this.on)) this.load(cx);
    const t = theme();
    const action = (id, label, run, primary = false) => h_flex().id(id).h(24).px(8).flex_none().items_center().rounded(6).text_size(11.5).cursor_pointer()
      .bg(primary ? t.solid : t.raised).text_color(primary ? t.solid_foreground : t.muted).hover((s) => s.opacity(0.85))
      .on_click((_e, cx) => { cx.stop_propagation(); run(cx); cx.notify(); }).child(label);
    const badge = (r) => {
      const [label, color] = !r ? ["Not run", t.dim] : r.state === "running" ? ["Running", t.working] : r.state === "pass" ? ["Passed", t.ansi2] : ["Failed", t.blocked];
      return div().flex_none().px(6).h(18).flex().items_center().rounded(5).bg(color + "26").text_size(10.5).font_semibold().text_color(color).child(label)
        .when(r?.state === "running", (el) => el.loop("opacity", { from: 0.45, to: 1, period: 1200 }));
    };
    const row = (c, i) => {
      const r = this.results.get(c.name), on = this.selected === c.name;
      return h_flex().id(`ck-${i}`).h(44).flex_none().px(8).gap(8).items_center().rounded(8).cursor_pointer().bg(on ? t.selected : t.background).hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => { this.select(on ? null : c.name); cx.notify(); })
        .child(v_flex().flex_1().min_w(0)
          .child(div().truncate().child(c.name))
          .child(div().truncate().text_size(11).text_color(t.dim).child(c.run)))
        .child(badge(r))
        .child(action(`ck-run-${i}`, "Run", (cx) => { this.runCheck(c, cx); }));
    };
    const done = this.checks.map((c) => this.results.get(c.name)?.state), passed = done.filter((s) => s === "pass").length, failed = done.filter((s) => s === "fail").length;
    const summary = !this.checks.length ? this.root?.split(/[\\/]/).pop() ?? "" : `${passed}/${this.checks.length} passed${failed ? ` · ${failed} failed` : ""}`;
    const note = (text) => div().p(8).text_size(12).text_color(t.dim).child(text);
    const selected = this.selected ? this.results.get(this.selected) : null;
    return v_flex().id("checks").size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border).text_color(t.foreground).text_size(13)
      .child(h_flex().h(42).flex_none().px(14).gap(6).items_center().border_b(1).border_color(t.border)
        .child(div().flex_none().font_semibold().child("Checks"))
        .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(failed ? t.blocked : t.dim).child(summary))
        .child(action("ck-reload", "Reload", (cx) => this.load(cx)))
        .when(this.checks.length > 0, (el) => el.child(action("ck-all", "Run all", (cx) => this.runAll(cx), true)))
        .child(action("ck-review", "Ask reviewer", () => this.askReviewer())))
      .child(v_flex().id("ck-list").flex_none().max_h(280).overflow_y_scrollbar().p(6).gap(2).children(this.checks.map(row))
        .when(!this.root, (el) => el.child(note("No folder")))
        .when(Boolean(this.error), (el) => el.child(note(this.error)))
        .when(Boolean(this.root) && this.missing && !this.on, (el) => el.child(v_flex().p(8).gap(10).items_start()
          .child(div().text_size(12).text_color(t.dim).child(`No ${FILE} in this folder. It lists the commands that prove the work: tests, a linter, a build.`))
          .child(action("ck-create", "Create an example", (cx) => this.create(cx), true))))
        .when(Boolean(this.root) && !this.missing && !this.error && !this.checks.length, (el) => el.child(note(`${FILE} has no checks yet.`))))
      .when(Boolean(this.selected), (el) => el.child(v_flex().flex_1().min_h(0).border_t(1).border_color(t.border)
        .child(div().h(24).flex_none().px(14).flex().items_center().text_size(11).text_color(t.dim).child(`Evidence · ${this.selected}`))
        .child(this.output ? Editor.new(this.output).flex_1().min_h(0) : note(selected?.state === "running" ? "Running…" : "Not run yet"))));
  }
}
