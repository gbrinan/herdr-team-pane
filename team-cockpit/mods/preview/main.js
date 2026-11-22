// Preview: the newest output in the focused pane's folder, shown beside the agents.
// Markdown is rendered, images are shown, text and code open read-only, HTML shows as plain
// text (no CSS) with an Open button for the real page; PDFs and office files open outside.
// It follows the newest file until you pick one from the list; "Latest" follows again.
//   panel:  { "id": "preview", "type": "block", "content": { "mod": "preview" } }
//   pane:   herdr-app do pane.split '{"direction":"right","mod":"preview"}'
//   props:  { folder?: "<dir>", file?: "<path under it>" } pin a folder or one file.
// Key commands while it shows: preview.latest, preview.refresh, preview.open.
// Words: English, or Korean when shared("team.lang") is "ko" (Team Bar's switch), props.lang
// says so, or the system's language is Korean.
import { View, div, image } from "gpui-kit";
import { v_flex, h_flex, Editor, EditorState, TextView } from "gpui-base";
import { spaces, panes, focused, exec, readTextFile, watchFolder, theme, settings, window, props, checking, notify, appHome, nextCommand, shared } from "herdr";
import * as fs from "fs/promises";

const DOCS = ["md", "markdown", "html", "htm", "png", "jpg", "jpeg", "gif", "webp", "svg", "pdf", "txt", "csv", "pptx", "docx", "xlsx"];
const SKIP = ["node_modules", "venv", "__pycache__", "dist", "build", "target", "AppData", "Library"];
const IMAGES = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg"]);
const OUTSIDE = new Set(["pdf", "pptx", "docx", "xlsx"]);
const LIMIT = 40, MAX_TEXT = 400000;
const SHOTS = "mods/preview/shots";

const WORDS = {
  en: { title: "Preview", source: "Source", text: "Text", latest: "Latest", refresh: "Refresh", open: "Open", recent: "Recent", hide: "Hide", show: "Show",
    noFolder: "No folder", looking: "Looking for files…", loading: "Loading…", drawing: "Drawing the page…",
    empty: "Nothing to preview yet. Markdown, HTML, images and documents made in this folder show up here.",
    outside: "This kind of file opens in its own app.", remoteImage: "Images on another machine are not shown.",
    gone: "This file is no longer available", binary: "Binary file · no text preview", unreadable: "Cannot preview this file (too large or unreadable)",
    noImage: "Cannot show this image here. Open shows it in its own app.", htmlNote: "Words only, without the page's styling. Open shows the real page in your browser.", newImage: "A picture made after Herdr started may stay blank here. Open shows it.",
    cannotOpen: "Cannot open this file", now: "now", m: "m", h: "h", d: "d" },
  ko: { title: "미리보기", source: "원문", text: "글자만", latest: "최신", refresh: "새로고침", open: "열기", recent: "최근", hide: "접기", show: "펴기",
    noFolder: "폴더 없음", looking: "파일 찾는 중…", loading: "불러오는 중…", drawing: "페이지 그리는 중…",
    empty: "아직 보여 줄 것이 없습니다. 이 폴더에 마크다운·HTML·그림·문서가 생기면 여기에 나옵니다.",
    outside: "이 파일은 전용 앱에서 열립니다.", remoteImage: "다른 컴퓨터의 그림은 보여 주지 않습니다.",
    gone: "파일이 없어졌습니다", binary: "글자가 아닌 파일 · 미리보기 없음", unreadable: "이 파일은 미리 볼 수 없습니다(너무 크거나 읽을 수 없음)",
    noImage: "여기서는 이 그림을 보여 줄 수 없습니다. 열기를 누르면 전용 앱에서 열립니다.", htmlNote: "글자만 보여 줍니다(꾸밈 없음). 열기를 누르면 브라우저에서 실제 페이지가 열립니다.", newImage: "Herdr를 켠 뒤에 생긴 그림은 여기서 비어 보일 수 있습니다. 열기를 누르면 보입니다.",
    cannotOpen: "파일을 열 수 없습니다", now: "방금", m: "분", h: "시간", d: "일" },
};
function words() {
  let lang = props()?.lang ?? shared("team.lang");
  if (!lang) { try { lang = Intl.DateTimeFormat().resolvedOptions().locale; } catch { lang = "en"; } }
  return String(lang).toLowerCase().startsWith("ko") ? WORDS.ko : WORDS.en;
}

const ext = (path) => (path.includes(".") ? path.split(".").pop().toLowerCase() : "");
function kind(path) {
  const e = ext(path);
  return e === "md" || e === "markdown" ? "markdown" : e === "html" || e === "htm" ? "html" : IMAGES.has(e) ? "image" : OUTSIDE.has(e) ? "outside" : "text";
}

function location() {
  const fixed = props()?.folder;
  const space = spaces().find((s) => s.active), f = focused();
  const pane = f?.pane ? panes().find((p) => p.pane === f.pane) : null;
  const on = f?.pane === null ? (f.terminal?.includes("/") ? f.terminal.split("/")[0] : null) : space?.machine ?? null;
  return { cwd: fixed || pane?.cwd || f?.cwd || space?.folder || null, on: fixed ? null : on };
}

// PowerShell reads curly single quotes as quotes too, so they are doubled like '.
const quote = (s) => "'" + s.replace(/['‘’‚‛]/g, "$&$&") + "'";

// Newest first, three folders deep, skipping hidden and dependency folders.
async function recent(root, on) {
  const windows = async () => {
    const list = (a) => a.map(quote).join(",");
    const script = "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); & { param($root) " +
      `$skip = ${list(SKIP)}; $ext = ${list(DOCS.map((e) => "." + e))}; $out = New-Object System.Collections.Generic.List[object]; ` +
      "function Walk($d, $depth) { try { foreach ($e in [IO.Directory]::EnumerateFileSystemEntries($d)) { if ($out.Count -ge 4000) { return }; $n = [IO.Path]::GetFileName($e); " +
      "if ([IO.Directory]::Exists($e)) { if ($depth -lt 3 -and $skip -notcontains $n -and -not $n.StartsWith('.')) { Walk $e ($depth + 1) } } " +
      "elseif ($ext -contains [IO.Path]::GetExtension($e).ToLower()) { $out.Add([IO.FileInfo]$e) } } } catch {} }; " +
      "$root = [IO.Path]::GetFullPath($root).TrimEnd('\\'); Walk $root 0; " +
      `@($out | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First ${LIMIT} | ForEach-Object { @{ path = $_.FullName.Substring($root.Length).TrimStart('\\').Replace('\\', '/'); ` +
      "time = [int64]($_.LastWriteTimeUtc - [datetime]'1970-01-01').TotalMilliseconds } }) | ConvertTo-Json -Compress } " + quote(root);
    const r = await exec("powershell", ["-NoProfile", "-Command", script], { on });
    if (r.code !== 0) throw new Error(r.stderr.trim() || "Cannot list this folder");
    const result = JSON.parse(r.stdout || "[]");
    return Array.isArray(result) ? result : [result];
  };
  if (!on && window()?.platform === "windows") return windows();
  const prune = SKIP.map((n) => `-name ${n}`).join(" -o "), names = DOCS.map((e) => `-iname '*.${e}'`).join(" -o ");
  const script = `cd "$1" && find . -maxdepth 4 \\( -name '.?*' -o ${prune} \\) -prune -o -type f \\( ${names} \\) -print0 | xargs -0 ls -t 2>/dev/null | head -${LIMIT}`;
  let r;
  try { r = await exec("sh", ["-c", script, "preview", root], { on }); }
  catch (e) {
    if (on && String(e).includes("cannot start sh")) return windows();
    throw e;
  }
  if (r.code !== 0 && !r.stdout) throw new Error(r.stderr.trim() || "Cannot list this folder");
  return r.stdout.split("\n").filter(Boolean).map((p) => ({ path: p.replace(/^\.\//, ""), time: null }));
}

// TextView draws tags without CSS, so drop what would show up as noise.
const plainHtml = (html) => html.replace(/<!--[\s\S]*?-->/g, "").replace(/<(script|style|head|svg|noscript)\b[\s\S]*?<\/\1>/gi, "");

function ago(time, w) {
  if (!time) return "";
  const s = Math.max(0, (Date.now() - time) / 1000);
  return s < 60 ? w.now : s < 3600 ? `${Math.floor(s / 60)}${w.m}` : s < 86400 ? `${Math.floor(s / 3600)}${w.h}` : `${Math.floor(s / 86400)}${w.d}`;
}

export default class Preview extends View {
  init(_props, cx) {
    this.files = []; this.file = null; this.follow = true; this.raw = false; this.plain = false; this.listOpen = true; this.version = 0;
    this.text = null;
    try { this.restore = JSON.parse(localStorage.getItem("state") ?? "null"); } catch { this.restore = null; }
    if (this.restore) { this.plain = Boolean(this.restore.plain); this.listOpen = this.restore.listOpen !== false; }
    if (checking()) return;
    this.refresh(cx);
    cx.timer.every(15000, (cx) => this.refresh(cx));
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        if (c === "latest") { this.follow = true; this.raw = false; this.refresh(cx, true); }
        else if (c === "refresh") this.refresh(cx, true);
        else if (c === "open") this.open();
        cx.notify();
      }
    });
  }

  watch(root, cx) {
    if (this.on || this.watched === root) return;
    this.watched = root;
    cx.spawn(async (cx) => {
      try { while (this.root === root) { await watchFolder(root); if (this.root === root) this.refresh(cx); } }
      catch { if (this.watched === root) this.watched = null; }
    });
  }

  refresh(cx, force = false) {
    const { cwd, on } = location();
    if (cwd !== this.root || on !== this.on) {
      this.root = cwd; this.on = on; this.files = []; this.follow = true; this.error = null; this.watched = null; this.loading = false;
      this.show(null);
      // After a self-reload: back to the file that was pinned.
      if (this.restore?.root === cwd && this.restore.follow === false && this.restore.file) { this.follow = false; this.file = this.restore.file; }
      this.restore = null;
    }
    if (!cwd || this.loading) return;
    this.loading = true;
    cx.spawn(async (cx) => {
      try {
        const files = await recent(cwd, on);
        if (this.root !== cwd) return;
        this.files = files; this.error = null; this.watch(cwd, cx);
        const fixed = props()?.file;
        const want = fixed || (this.follow || !this.file ? files[0]?.path : this.file) || null;
        const time = files.find((f) => f.path === want)?.time ?? null;
        if (want !== this.file || time !== this.shownTime || force) this.show(want, cx, time);
        this.remember();
      } catch (e) { if (this.root === cwd) this.error = String(e.message ?? e); }
      finally { if (this.root === cwd) this.loading = false; cx.notify(); }
    });
  }

  show(path, cx, time = null) {
    this.code?.release(); this.code = null; this.text = null; this.fileError = null; this.picture = null; this.making = false; this.pageFailed = false;
    this.file = path; this.shownTime = time; this.version++;
    if (!path || !cx) return;
    const k = kind(path);
    if (k === "outside") return;
    const root = this.root, on = this.on, version = this.version;
    if (k === "image") { if (!on) cx.spawn((cx) => this.copyImage(`${root}/${path}`, version, time, cx)); return; }
    cx.spawn(async (cx) => {
      try {
        const text = await readTextFile(`${root}/${path}`, { on });
        if (this.version !== version) return;
        if (text === null) { this.fileError = "gone"; return; }
        if (text.includes("\0")) { this.fileError = "binary"; return; }
        this.text = text.length > MAX_TEXT ? text.slice(0, MAX_TEXT) + "\n… (file truncated)" : text;
        const t = theme(), e = ext(path) || "txt";
        this.code = EditorState.new({ language: e === "htm" ? "html" : e === "markdown" ? "md" : e, readonly: true, value: this.text,
          font_family: settings().font_family, font_size: 12,
          syntax: { keyword: t.ansi5, string: t.ansi2, comment: t.dim, function: t.ansi4, type: t.ansi3, number: t.ansi1, constant: t.ansi6 } });
      } catch { if (this.version === version) this.fileError = "unreadable"; }
      finally { cx.notify(); }
    });
  }

  // image() only reads under the app's folder, so a picture is copied to mods/preview/shots/,
  // named after the source file and its time (found again later instead of copied twice; at
  // most 8 are kept). The app draws such a copy reliably only if it was there when the mod
  // loaded: a picture made later can stay blank until the mod loads again.
  async shotFile(full, time, e) {
    let h = 5381;
    for (const c of full) h = ((h * 33) ^ c.charCodeAt(0)) >>> 0;
    if (!time) throw new Error("no time"); // without it every reload would make a new picture
    const dir = `${appHome()}/${SHOTS}`, name = `${h.toString(36)}-${time}.${e}`;
    await fs.mkdir(dir, { recursive: true });
    const have = await fs.exists(`${dir}/${name}`);
    if (!have) {
      const old = (await fs.readdir(dir)).filter((n) => n !== name);
      if (old.length >= 8) for (const n of old) await fs.unlink(`${dir}/${n}`).catch(() => {});
    }
    return { to: `${dir}/${name}`, path: `${SHOTS}/${name}`, have };
  }

  remember() {
    const state = JSON.stringify({ root: this.root, file: this.file, follow: this.follow, plain: this.plain, listOpen: this.listOpen });
    if (state === this.saved) return;
    this.saved = state;
    try { localStorage.setItem("state", state); } catch { /* not kept */ }
  }

  async copyImage(full, version, time, cx) {
    try {
      const shot = await this.shotFile(full, time, ext(full));
      if (this.version === version) { this.picture = shot.path; this.making = !shot.have; cx.notify(); }
      if (!shot.have) {
        const r = window()?.platform === "windows"
          ? await exec("powershell", ["-NoProfile", "-Command", `Copy-Item -LiteralPath ${quote(full.replace(/\//g, "\\"))} -Destination ${quote(shot.to.replace(/\//g, "\\"))}`])
          : await exec("cp", [full, shot.to]);
        if (r.code !== 0) throw new Error(r.stderr);
      }
    } catch { if (this.version === version) { this.picture = null; this.fileError = "noImage"; } }
    finally { if (this.version === version) this.making = false; cx.notify(); }
  }

  // The real thing: the browser for HTML, the system's app for everything else.
  open() {
    if (!this.file || this.on) return;
    const full = `${this.root}/${this.file}`, platform = window()?.platform;
    const w = words();
    const done = (r) => { if (r.code !== 0) notify({ title: w.title, body: r.stderr.trim() || w.cannotOpen, level: "error" }); };
    const fail = (e) => notify({ title: w.title, body: String(e), level: "error" });
    if (platform === "windows") exec("powershell", ["-NoProfile", "-Command", "Start-Process -LiteralPath " + quote(full.replace(/\//g, "\\"))]).then(done, fail);
    else exec(platform === "macos" ? "open" : "xdg-open", [full]).then(done, fail);
  }

  action(t, id, label, run, primary = false, on = false) {
    return h_flex().id(id).h(24).px(8).flex_none().items_center().rounded(6).text_size(11.5).cursor_pointer()
      .bg(primary ? t.solid : on ? t.selected : t.raised).text_color(primary ? t.solid_foreground : on ? t.foreground : t.muted)
      .hover((s) => s.opacity(0.85)).on_click((_e, cx) => { run(cx); cx.notify(); }).child(label);
  }

  // A picture as wide as the panel: the page's own shape for a page shot, a square otherwise.
  picture_(ratio) {
    const width = this.box ? Math.max(80, Math.floor(this.box / (settings().zoom || 1)) - 24) : null;
    const img = width ? image(this.picture).w(width).h(Math.round(width * ratio)) : image(this.picture).w_full().aspect_square();
    return div().id("pv-image").flex_1().min_h(0).overflow_y_scrollbar().p(12)
      .on_size_change((size, cx) => { if (Math.abs((this.box ?? 0) - size.width) > 1) { this.box = size.width; cx.notify(); } })
      .child(div().pb(8).text_size(11).text_color(theme().dim).child(words().newImage))
      .child(img);
  }

  body(t, w) {
    const note = (text) => div().p(14).text_size(12).text_color(t.dim).child(text);
    if (!this.root) return note(w.noFolder);
    if (!this.file) return note(this.error || (this.loading ? w.looking : w.empty));
    const k = kind(this.file);
    if (k === "outside") return v_flex().p(14).gap(10).items_start()
      .child(div().text_size(12).text_color(t.dim).child(w.outside))
      .child(this.action(t, "pv-open-big", w.open, () => this.open(), true));
    if (this.fileError) return note(w[this.fileError] ?? this.fileError);
    if (k === "image") {
      if (this.on) return note(w.remoteImage);
      return this.picture ? this.picture_(1) : note(w.loading);
    }
    if (this.text === null) return note(w.loading);
    if (this.raw || k === "text") return this.code ? Editor.new(this.code).flex_1().min_h(0) : note(w.loading);
    const id = `pv-${k}-${this.version}`;
    return v_flex().flex_1().min_h(0)
      .when(k === "html", (el) => el.child(div().flex_none().px(16).pt(10).text_size(11).text_color(t.dim).child(w.htmlNote)))
      .child(div().id("pv-doc").flex_1().min_h(0).overflow_y_scrollbar().px(16).py(12).text_size(13)
        .child((k === "markdown" ? TextView.markdown(id, this.text) : TextView.html(id, plainHtml(this.text))).selectable(true)));
  }

  render(cx) {
    const now = location();
    if (!checking() && (now.cwd !== this.root || now.on !== this.on)) this.refresh(cx);
    if (!checking() && this.root) this.remember();
    const t = theme(), w = words(), k = this.file ? kind(this.file) : null, fixed = Boolean(props()?.file);
    const row = (f) => {
      const on = f.path === this.file, slash = f.path.lastIndexOf("/");
      return h_flex().id(`pv-f-${f.path}`).h(26).flex_none().px(8).gap(8).items_center().rounded(6).cursor_pointer()
        .bg(on ? t.selected : t.background).hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => { this.follow = false; this.raw = false; this.show(f.path, cx, f.time); cx.notify(); })
        .child(div().flex_none().max_w(220).truncate().text_color(on ? t.foreground : t.muted).child(f.path.slice(slash + 1)))
        .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).child(slash < 0 ? "" : f.path.slice(0, slash)))
        .child(div().flex_none().text_size(11).text_color(t.dim).child(ago(f.time, w)));
    };
    return v_flex().id("preview").size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border).text_color(t.foreground).text_size(13)
      .child(h_flex().h(42).flex_none().px(14).gap(6).items_center().border_b(1).border_color(t.border)
        .child(div().flex_none().font_semibold().child(w.title))
        .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.dim).child(fixed ? this.file : this.root?.split(/[\\/]/).pop() ?? ""))
        .when(k === "markdown" || k === "html", (el) => el.child(this.action(t, "pv-raw", w.source, () => { this.raw = !this.raw; }, false, this.raw)))
        .when(!fixed, (el) => el.child(this.action(t, "pv-latest", w.latest, (cx) => { this.follow = true; this.raw = false; this.refresh(cx); }, false, this.follow)))
        .child(this.action(t, "pv-refresh", w.refresh, (cx) => this.refresh(cx, true)))
        .when(Boolean(this.file) && !this.on, (el) => el.child(this.action(t, "pv-open", w.open, () => this.open(), k === "html"))))
      .when(!fixed && this.files.length > 0, (el) => el.child(v_flex().flex_none().border_b(1).border_color(t.border)
        .child(h_flex().id("pv-list-head").h(24).px(14).items_center().cursor_pointer().text_size(11).text_color(t.dim)
          .on_click((_e, cx) => { this.listOpen = !this.listOpen; cx.notify(); })
          .child(div().flex_1().min_w(0).truncate().child(this.listOpen ? `${w.recent} · ${this.files.length}` : this.file ?? "")).child(this.listOpen ? w.hide : w.show))
        .when(this.listOpen, (el) => el.child(v_flex().id("pv-list").max_h(138).overflow_y_scrollbar().px(6).pb(6).text_size(12).children(this.files.map(row))))))
      .child(this.body(t, w));
  }
}
