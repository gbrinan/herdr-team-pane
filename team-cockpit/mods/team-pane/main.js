// Team Pane: a pane header that shows which team member each pane is.
//   { "tab": "active", "pane": { "header": { "content": { "mod": "team-pane" } } } }
// Shows the program's icon, the member's name (or the agent's / terminal's name), the program
// and role, the folder and the agent's status. The left band and a light wash take the member's
// color; the band breathes while the agent works and turns the "blocked" color when it needs you.
// Hover buttons: edit team (name, role, color), split, zoom, close. Click: focus the pane.
// Key command: team-pane.edit edits the focused pane's team (bind it in keys.json).
//
// Team labels live on the terminal (herdr-core), so every Herdr client sees them:
//   team.title  shown name (any language)   team.color  #rrggbb   team.role  free text
// Set them here (the tag button), with `hc label t3 team.title=Planner team.color=#D97757`,
// or with team_start.py, which starts a whole team at once.

import { View, div, svg, image } from "gpui-kit";
import { h_flex } from "gpui-base";
import { panes, props, run, theme, home, layout, terminals, openOverlay, focused, nextCommand, settings } from "herdr";
import { initEditor, renderEditor, validColor } from "./editor.js";

function teamLabels(address) {
  if (!address) return {};
  const t = terminals().find((x) => x.address === address);
  return t?.labels ?? {};
}

// Match the first visible tab frame, including the active child of a stack.
function paneFrame(node) {
  if (!node || node.hidden) return null;
  if (node.content?.tab && node.content.pane) return node.content.pane;
  let children = node.children ?? [];
  if (node.type === "stack") {
    const visible = children.filter(child => !child.hidden);
    children = [visible.find(child => child.id === node.active) ?? visible[0]];
  }
  for (const child of children) {
    const frame = paneFrame(child);
    if (frame) return frame;
  }
  return null;
}

// On a dark theme the member's color is lifted toward white (30%) so the name stays readable.
function nameColor(c) {
  if (!c || !settings()?.dark) return c;
  const n = parseInt(c.slice(1, 7), 16);
  const lift = (v) => Math.round(v + (255 - v) * 0.3).toString(16).padStart(2, "0");
  return "#" + lift(n >> 16) + lift((n >> 8) & 255) + lift(n & 255);
}

function icon(p, size, color) {
  if (!p?.icon) return null;
  return p.tint ? svg(p.icon).size(size).flex_none().text_color(color) : image(p.icon).w(size).h(size).flex_none();
}

function folder(cwd) {
  if (!cwd) return "";
  const h = home();
  const sep = h.includes("\\") ? "\\" : "/";
  return cwd === h ? "~" : cwd.startsWith(h + sep) || cwd.startsWith(h + "/") ? "~" + cwd.slice(h.length) : cwd;
}

export default class Pane extends View {
  init(initial, cx) {
    if ((initial ?? props())?.edit) return initEditor(this, cx);
    this.hovered = false;
    // Key command "team-pane.edit" (bind it in keys.json): edit the focused pane's team.
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        if (c !== "edit" || focused()?.pane !== props()?.pane) continue;
        const p = this.me();
        const address = props()?.terminal ?? p?.terminal;
        this.edit(address, teamLabels(address), "dialog");
      }
    });
  }

  me() {
    return panes().find((p) => p.pane === props()?.pane);
  }

  button(t, id, icon, action) {
    return div()
      .id(id)
      .p(3)
      .rounded(4)
      .text_color(t.dim)
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_click((_e, cx) => {
        cx.stop_propagation();
        action();
      })
      .child(svg(`mods/team-pane/${icon}.svg`).size(14));
  }

  // From the tag button: a popup at the pointer. From the key command: a centered dialog.
  edit(address, lb, kind = "popup") {
    if (!address) return;
    openOverlay({
      mod: "team-pane",
      kind,
      width: 300,
      height: 330,
      props: { edit: { terminal: address, title: lb["team.title"] ?? "", color: lb["team.color"] ?? "", role: lb["team.role"] ?? "" } },
    });
  }

  render(cx) {
    if (this.editing) return renderEditor(this);
    const t = theme();
    const p = this.me();
    if (!p) return div();
    const address = props()?.terminal ?? p.terminal;
    const lb = teamLabels(address);
    const teamColor = validColor(lb["team.color"]);
    const teamTitle = lb["team.title"];
    const teamRole = lb["team.role"];
    const progName = ((p.program?.agent || p.program?.shell) && p.program.name) || p.title || p.program?.name || "shell";
    const name = teamTitle || progName;
    const pic = icon(p.program, 14, t.dim);
    const st = p.status;
    const pane = p.pane;
    const frame = paneFrame(layout());
    const bottom = frame?.header?.position === "bottom";
    // Follow the card's rounding so the wash and band stay inside its corners (inset by its border).
    const r = Math.max(0, (Number(frame?.radius) || 0) - (Number(frame?.border?.width) || 0));
    // The band: blocked wins (it needs you), then the member's color, then "working".
    const bandColor = st === "blocked" ? t.blocked : teamColor ?? (st === "working" ? t.working : null);
    const wash = st === "blocked" ? t.blocked + "26" : teamColor ? teamColor + "1f" : t.background;
    // Children aren't clipped to rounded corners, so the band is two layers that follow the curve:
    // a band-colored corner piece, and over it, 4 px in, a piece in the header's own color.
    const corner = (el, rad) => (rad <= 0 ? el : bottom ? el.rounded_bl(rad) : el.rounded_tl(rad));
    const inner = Math.max(0, r - 4);
    const layers = bandColor ? [
      corner(div().absolute().top(0).bottom(0).left(0).w(r + 8).bg(bandColor), r)
        .when(st === "working", (el) => el.loop("opacity", { from: 0.35, to: 1, period: 1600 }))
        .when(st === "blocked", (el) => el.loop("opacity", { from: 0.4, to: 1, period: 700 })),
      corner(div().absolute().top(0).bottom(0).left(4).w(r + 8).bg(t.background), inner)
        .child(corner(div().size_full().bg(wash), inner)),
    ] : [];
    return h_flex()
      .id(`pane-head-${pane}`)
      .relative()
      .size_full()
      .pr(10)
      .gap(8)
      .items_center()
      .bg(wash)
      .when(r > 0, (el) => (bottom ? el.rounded_b(r) : el.rounded_t(r)))
      .children(layers)
      .child(div().w(4).h_full().flex_none())
      .when(bottom, el => el.border_t(1))
      .when(!bottom, el => el.border_b(1))
      .border_color(t.border)
      .text_size(12)
      .on_hover((hovered, cx) => { this.hovered = hovered; cx.notify(); })
      .on_click(() => run("pane.focus", { pane }))
      .when(Boolean(pic), (el) => el.child(pic))
      .child(div().flex_none().truncate().max_w(260).font_semibold().text_color(nameColor(teamColor) ?? t.foreground).child(name))
      .when(Boolean(teamTitle), (el) => el.child(div().flex_none().truncate().max_w(160).text_color(t.muted).child(teamRole ? `${progName} · ${teamRole}` : progName)))
      .child(div().flex_1().truncate().text_color(t.dim).child(folder(p.cwd)))
      .when(st === "working", el => el.child(svg("mods/workspace-chrome/spinner.svg").size(12).flex_none().text_color(t.working).spin(900)))
      .when(st === "blocked", el => el.child(div().flex_none().px(6).h(18).flex().items_center().rounded(5).bg(t.blocked + "26").text_size(10.5).font_semibold().text_color(t.blocked).child("Needs you")))
      .when(st === "done", el => el.child(div().size(7).flex_none().rounded(4).bg(t.done)))
      .when(this.hovered, el => el
        .when(Boolean(address), (el) => el.child(this.button(t, `ph-t-${pane}`, "tag", () => this.edit(address, lb))))
        .child(this.button(t, `ph-r-${pane}`, "split-right", () => run("pane.split", { direction: "right", pane })))
        .child(this.button(t, `ph-d-${pane}`, "split-down", () => run("pane.split", { direction: "down", pane })))
        .child(this.button(t, `ph-z-${pane}`, p.zoomed ? "unzoom" : "zoom", () => run("pane.zoom", { pane })))
        .child(this.button(t, `ph-x-${pane}`, "close", () => run("pane.close", { pane }))));
  }
}
