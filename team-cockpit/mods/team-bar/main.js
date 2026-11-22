// Team Bar: one row to say what you want and start a team on it.
//   { "id": "team-bar", "type": "block", "size": { "px": 44 }, "content": { "mod": "team-bar" } }
// Type the task, pick a team file (click the team button to cycle), press Start or Enter:
// it runs team_start.py (next to this file) in the focused pane's folder, which opens a space
// with a grid of agents, each with its role, the task and its Team Pane labels.
// Team files: <folder>/team.json, <folder>/teams/*.json, then the examples in teams/ here.
// On the right, Preview and Checks open those panels when the layout has them
// (blocks "preview" / "checks" in a stack "panel-body" inside a node "panel").
// Key commands (bind in keys.json): team-bar.focus (type a task), team-bar.start,
// team-bar.preview and team-bar.checks (open or close that panel).
import { View, div } from "gpui-kit";
import { h_flex, InputState, Input } from "gpui-base";
import { spaces, panes, focused, exec, theme, window, layout, run, appHome, checking, notify, nextCommand } from "herdr";
import * as fs from "fs/promises";

const find = (node, id) => {
  if (!node) return null;
  if (node.id === id) return node;
  for (const child of node.children ?? []) { const hit = find(child, id); if (hit) return hit; }
  return null;
};

function folder() {
  const space = spaces().find((s) => s.active), f = focused();
  const pane = f?.pane ? panes().find((p) => p.pane === f.pane) : null;
  return pane?.cwd || f?.cwd || space?.folder || null;
}

async function teamFiles(cwd) {
  const out = [], here = `${appHome()}/mods/team-bar/teams`;
  const add = async (dir, where) => {
    try { for (const name of (await fs.readdir(dir)).sort()) if (name.endsWith(".json")) out.push({ path: `${dir}/${name}`, name: name.slice(0, -5), where }); }
    catch { /* no such folder */ }
  };
  if (cwd) {
    const root = cwd.replace(/\\/g, "/");
    try { if (await fs.exists(`${root}/team.json`)) out.push({ path: `${root}/team.json`, name: "team", where: "folder" }); } catch { /* outside home */ }
    await add(`${root}/teams`, "folder");
  }
  await add(here, "example");
  return out;
}

export default class TeamBar extends View {
  init(_props, cx) {
    this.teams = []; this.pick = 0; this.busy = false; this.active = false;
    this.task = InputState.new({ value: "", placeholder: "What should the team do?" });
    this.task.on("submit", (_e, cx) => this.start(cx));
    this.task.on("focus", (_e, cx) => { this.active = true; cx.notify(); });
    this.task.on("blur", (_e, cx) => { this.active = false; cx.notify(); });
    if (checking()) return;
    this.load(cx);
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        if (c === "focus") this.task.focus();
        else if (c === "start") this.start(cx);
        else if (c === "preview" || c === "checks") this.togglePanel(c);
        cx.notify();
      }
    });
  }

  togglePanel(id) {
    const root = layout(), panel = find(root, "panel"), body = find(root, "panel-body");
    if (!panel || !find(body, id)) return;
    if (!panel.hidden && body.active === id) run("layout.hide", { id: "panel" });
    else { run("layout.select", { stack: "panel-body", child: id }); run("layout.show", { id: "panel" }); }
  }

  load(cx) {
    const cwd = folder();
    this.cwd = cwd;
    cx.spawn(async (cx) => {
      const teams = await teamFiles(cwd);
      if (this.cwd !== cwd) return;
      const chosen = this.teams[this.pick]?.path;
      this.teams = teams;
      this.pick = Math.max(0, teams.findIndex((t) => t.path === chosen));
      cx.notify();
    });
  }

  start(cx) {
    const cwd = this.cwd, chosen = this.teams[this.pick]?.path;
    if (this.busy) return;
    const task = this.task.value().trim(), script = `${appHome()}/mods/team-bar/team_start.py`;
    this.busy = true;
    cx.notify();
    cx.spawn(async (cx) => {
      let team = null;
      try {
        // Team files come and go (an agent may have just written one): look again.
        this.teams = await teamFiles(cwd);
        this.pick = Math.max(0, this.teams.findIndex((t) => t.path === chosen));
        team = this.teams[this.pick];
        if (!team) throw new Error("No team file. Put a team.json in this folder (see mods/team-bar/teams for examples).");
        const args = [script, team.path, ...(task ? ["--task", task] : [])];
        const options = { cwd: cwd ?? undefined, timeout: 180000 };
        let r;
        try { r = await exec(window()?.platform === "windows" ? "python" : "python3", args, options); }
        catch { r = await exec(window()?.platform === "windows" ? "py" : "python", args, options); }
        if (r.code !== 0) throw new Error(r.stderr.trim() || `team_start.py failed (${r.code})`);
        const members = r.stdout.split("\n").filter((line) => line.startsWith("slot ")).length;
        notify({ title: "Team Bar", body: `${team.name}: ${members} panes started` });
        this.task.set_value("");
      } catch (e) { notify({ title: "Team Bar", body: String(e.message ?? e).slice(0, 400), level: "error" }); }
      finally { this.busy = false; cx.notify(); }
    });
  }

  render(cx) {
    if (!checking() && folder() !== this.cwd) this.load(cx);
    const t = theme(), team = this.teams[this.pick];
    const root = layout(), panel = find(root, "panel"), body = find(root, "panel-body");
    const chip = (id, label, on, action, primary = false) => h_flex().id(id).h(28).px(10).flex_none().items_center().rounded(8)
      .text_size(12).cursor_pointer().border_1().border_color(primary ? t.solid : on ? t.input : t.border)
      .bg(primary ? t.solid : on ? t.selected : t.chrome).text_color(primary ? t.solid_foreground : on ? t.foreground : t.muted)
      .hover((s) => s.opacity(0.85)).on_click((_e, cx) => { action(cx); cx.notify(); }).child(label);
    const panelChip = (id, label) => {
      if (!panel || !find(body, id)) return null;
      const on = !panel.hidden && body.active === id;
      return chip(`tb-${id}`, label, on, () => this.togglePanel(id));
    };
    return h_flex().id("team-bar").size_full().px(14).gap(8).items_center().bg(t.chrome).border_b(1).border_color(t.border).text_color(t.foreground)
      .child(Input.new(this.task).flex_1().min_w(0).h(28).px(10).rounded(8).border_1()
        .border_color(this.active ? t.accent : t.input).bg(t.background).text_size(12.5).text_color(t.foreground))
      .child(chip("tb-team", team ? `Team · ${team.name}` : "No team file", false, (cx) => { if (this.teams.length) this.pick = (this.pick + 1) % this.teams.length; this.load(cx); }))
      .child(chip("tb-start", this.busy ? "Starting…" : "Start", false, (cx) => this.start(cx), Boolean(team) && !this.busy))
      .child(div().w(1).h(18).flex_none().bg(t.border))
      .children([panelChip("preview", "Preview"), panelChip("checks", "Checks")].filter(Boolean));
  }
}
