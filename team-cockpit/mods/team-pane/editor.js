// The team editor: a popup the header opens (props { edit: { terminal, title, color, role } }).
// Saves the three labels on the terminal with `hc label`; an empty field removes its label.
import { div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { hc, props, closeOverlay, theme, notify } from "herdr";

export const SWATCHES = ["#D97757", "#5E8D7A", "#B99A45", "#4F7CAC", "#8E6BB8", "#C2577A", "#3E9AA6", "#7A7F87"];

export function validColor(c) {
  return typeof c === "string" && /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(c) ? c : null;
}

export function initEditor(view, cx) {
  const e = props()?.edit ?? {};
  view.editing = true;
  view.color = validColor(e.color);
  view.title = InputState.new({ value: e.title ?? "", placeholder: "Planner, 기획, …" });
  view.role = InputState.new({ value: e.role ?? "", placeholder: "planner" });
  view.focusedInput = "title";
  for (const [name, input] of [["title", view.title], ["role", view.role]]) {
    input.on("submit", () => save(view));
    input.on("focus", (_e, cx) => { view.focusedInput = name; cx.notify(); });
    input.on("blur", (_e, cx) => { if (view.focusedInput === name) view.focusedInput = null; cx.notify(); });
  }
  view.title.focus();
  cx.timer.after(600, () => view.title.focus());
  view.handle = cx.focus_handle();
}

function save(view, clear = false) {
  const p = props();
  const terminal = p?.edit?.terminal;
  closeOverlay(p.overlay);
  if (!terminal) return;
  const title = clear ? "" : view.title.value().trim();
  const role = clear ? "" : view.role.value().trim();
  const color = clear ? "" : (view.color ?? "");
  // `key=` removes a label, so empty fields clear themselves.
  hc(["label", terminal, `team.title=${title}`, `team.role=${role}`, `team.color=${color}`])
    .then((r) => {
      if (r.code !== 0) notify({ title: "Team Pane", body: r.stderr.trim() || `hc label failed (${r.code})`, level: "error" });
    })
    .catch((err) => notify({ title: "Team Pane", body: String(err), level: "error" }));
}

export function renderEditor(view) {
  const t = theme();
  const p = props() ?? {};
  const label = (text) => div().pt(14).pb(6).text_size(11.5).text_color(t.dim).child(text);
  const field = (name, input) => Input.new(input).h(34).px(10).rounded(8).border_1()
    .border_color(view.focusedInput === name ? t.accent : t.input).bg(t.background).text_size(12.8).text_color(t.foreground);
  const button = (id, text, primary, action) => h_flex().id(id).h(30).px(12).items_center().rounded(8)
    .border_1().border_color(primary ? t.solid : t.input).bg(primary ? t.solid : t.raised)
    .text_color(primary ? t.solid_foreground : t.foreground).text_size(12.5).font_medium().cursor_pointer()
    .hover((s) => s.opacity(0.88)).on_click(action).child(text);
  const custom = view.color && !SWATCHES.some((s) => s.toLowerCase() === view.color.toLowerCase().slice(0, 7)) ? [view.color] : [];
  const swatch = (c, i) => div().id(`tp-sw-${i}`).size(22).rounded(11).cursor_pointer()
    .bg(c ?? t.background).border_2()
    .border_color(view.color === c ? t.foreground : (c ? "#00000000" : t.input))
    .hover((s) => s.opacity(0.85))
    .on_click((_e, cx) => { view.color = c; cx.notify(); })
    .when(!c, (el) => el.flex().items_center().justify_center().text_size(11).text_color(t.dim).child("–"));
  return v_flex().id("tp-editor").track_focus(view.handle)
    .on_key_down((e, cx) => { if (e.key === "escape") { closeOverlay(p.overlay); cx.stop_propagation(); } })
    .w_full().min_h(0).p(16).bg(t.popover).text_color(t.foreground)
    .child(h_flex().items_center()
      .child(div().flex_1().text_size(14.5).font_semibold().child("Team"))
      .child(div().text_size(11).text_color(t.dim).child(p.edit?.terminal ?? "")))
    .child(label("Name"))
    .child(field("title", view.title))
    .child(label("Role"))
    .child(field("role", view.role))
    .child(label("Color"))
    .child(h_flex().gap(6).flex_wrap().children([...SWATCHES, ...custom, null].map(swatch)))
    .child(h_flex().pt(18).gap(8).items_center()
      .child(button("tp-clear", "Clear", false, () => save(view, true)))
      .child(div().flex_1())
      .child(button("tp-cancel", "Cancel", false, () => closeOverlay(p.overlay)))
      .child(button("tp-save", "Save", true, () => save(view))));
}
