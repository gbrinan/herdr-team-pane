# Team Cockpit

Herdr's own window, made for running a team of agents side by side, in black with one amber
accent: every pane is a rounded card with a Team Pane header carrying the member's name, role and
color, so a 2×2 or 1×3 grid of agents reads at a glance. A faint grid with small crosses shows in
the gutters. Under the tab bar, a Team Bar takes the task and starts a team; on the right, next
to Files and Changes, a Preview panel shows the newest output and a Checks panel runs the
folder's checks. Spaces and agents stay on the left, as in Herdr's main layout.

![Team Cockpit](preview.png)

## What you see

Left to right:

1. **Sidebar** (268 px, 44–480, `chrome` `#0a0a0a`): the Herdr brand row (46 px,
   `workspace-chrome`), Spaces and Agents lists sharing the height (`spaces`, `agents`, at least
   90 px each), and a 69 px footer (`workspace-chrome` with `footer: true`).
2. **Work** column: the tab bar (42 px, `tabs`), the **Team Bar** (44 px: task field, team
   chip, Start, Preview and Checks chips), then the panes of the shown tab as cards
   (14 px padding and gap, 16 px radius, 1 px `border` `#292929`, 1 px amber `#ffae00` ring on the
   focused pane, black inside) beside a hidden side panel (368 px, 280–900, a stack of `files`,
   `changes`, `preview` and `checks`), then a 28 px status bar (`workspace-status`).
3. Each pane card's header is **Team Pane**, 30 px high, always shown, on top: the member's color
   band and wash, name, program · role, folder, status, hover buttons (see the Team Pane recipe).

The window has no system title bar (`titlebar: none`); terminals are padded 14 × 12 px.

**Look** (its own theme `team-cockpit`): black `#000` behind and inside the cards; greys `#0a0a0a`
(chrome), `#111111` (surface), `#1a1a1a` (popover), `#1f1f1f` (raised, hover), `#292929`
(selected, border), `#454545` (input, selection); text `#ededed`, muted `#a0a0a0`, dim `#878787`;
one accent, amber `#ffae00`, for focus, primary buttons (black text), the cursor and `working`;
`blocked` `#ff5a4f`, `done` `#6aa8ff`. Terminal colors: `#292929 #ff6b5f #7fd17a #ffae00 #6aa8ff
#c792ea #5fd0d6 #d4d4d4`, bright `#878787 #ff8a80 #9fe09a #ffc94d #8fbcff #d7aef2 #86e0e4 #ffffff`.
UI text in Pretendard (Regular, Medium, SemiBold, Bold); terminals keep the person's font.
Background: `art/grid.png` (2560 × 1600, `cover`): black, 1 px lines `#0e0e0e` every 40 px, and a
10 px cross `#454545` every 160 px. It shows in the gutters between cards. Team colors stay the
members' own; amber is only for focus and actions.

## How it behaves

- Everything Herdr's main layout does: spaces, agents, tabs, Files, Changes, status bar.
- Pane headers: as Team Pane. Hover a header and press the tag to name a pane, give it a role and
  a color; `team-pane.edit` does it for the focused pane from the keyboard.
- Team Bar: type a task, Enter or Start: `team_start.py` opens a space with the team's grid.
- Preview and Checks chips (or `team-bar.preview` / `team-bar.checks`) open and close those
  panels; Files and Changes keep their buttons in the tab bar.
- `ctrl-shift-l` switches layouts; the person's own layout stays as it was.

## Built from

- `layouts/team-cockpit.json`: a copy of Herdr's `main` layout (0.1.16). Root: `"theme":
  "team-cockpit"`, `"ui_font": "Pretendard"`, `"background": { "image":
  "mods/team-cockpit/art/grid.png", "fit": "cover" }`. `work-body`: padding 14, gap 14. Tab
  block's pane frame: radius 16, gap 14, border 1 `border`, focus 1 `accent`, header
  `{ "content": { "mod": "team-pane" }, "reveal": "always", "height": 30, "position": "top" }`.
  `work` gets a block `team-bar` (44 px, mod `team-bar`) after `tabs`; the stack `panel-body`
  gets blocks `preview` and `checks` after `files` and `changes`.
- `layouts/team-cockpit.png`: a 640 px screenshot the settings screen shows (root `"preview"`).
- `themes/team-cockpit.json`: the theme above (named like the layout, so it is the layout's own).
- `mods/team-cockpit/`: art only, a mod that draws nothing (`place: none`): `fonts/` (Pretendard
  OTFs and their OFL licence, loaded by Herdr from any mod's `fonts/`) and `art/grid.png`.
- `mods/team-pane/`, `mods/team-bar/`, `mods/preview/`, `mods/checks/`: the four mods (each
  has its own recipe in the repo's folder of that name).
- `keys.json`: for this layout only, `ctrl-shift-m` edit the pane's team, `ctrl-shift-i` type a
  task, `ctrl-shift-r` Preview, `ctrl-shift-g` Checks.
- Shipped mods it uses: `workspace-chrome`, `spaces`, `agents`, `tabs`, `files`, `changes`,
  `workspace-status`.
- `team_start.py` (inside `mods/team-bar/`, also `scripts/` in the repo) starts a whole team
  (a space, a grid of panes, an agent with a role in each, and the labels) from one JSON file.

## Watch out

- Programs run only on your click: Team Pane runs `hc label` on Save; Team Bar runs
  `team_start.py` on Start (real agents start); Checks runs the lines in the folder's
  `herdr-checks.json` on Run and `hc send` on Ask reviewer; Preview lists files and copies the
  shown image. Nothing reaches the network.
- Tab-bar memory: Herdr's `tabs` remembers the side panel per space only for Files and Changes,
  so Preview or Checks closes when you switch spaces.
- The layout copies `main` as of Herdr 0.1.16. If a later `main` changes, clone it again
  (`layout.clone`) and set the tab block's header mod to `team-pane`.
- Shipped mods are referenced by name, so they must exist (they ship with Herdr).
- Install `themes/team-cockpit.json` too, or the layout falls back to the person's theme.
- Fonts load at start or on the next look change: switch layouts once after copying them.
- The grid only shows where nothing covers the background; wider gaps show more of it.

## Done when

- `herdr-app check ~/.config/herdr-app/mods/team-pane` passes and
  `herdr-app do layout.switch '{"name":"team-cockpit"}'` shows the window with no errors in
  `herdr-app status`.
- A pane labelled with `hc label t3 team.title=Planner team.color=#D97757` shows the orange
  header; an unlabelled pane looks like Herdr's own.
- `python scripts/team_start.py scripts/teams/example.json` opens a space with three labelled
  agents in a row; so does Start in the Team Bar with that team chosen.
- `herdr-app do team-bar.preview` shows the newest Markdown file of the folder, rendered;
  `herdr-app do team-bar.checks` shows the Checks panel.
