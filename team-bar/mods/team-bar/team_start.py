"""Start a team in the Herdr app: one space, a rows x cols grid of panes, each pane running an
agent with its role and task, and Team Pane labels (team.title / team.color / team.role) on it.

Usage:
    python team_start.py <team.json> [--task "shared task"] [--dry-run]

Team file (UTF-8 JSON):
{
  "name": "content-team",               # space name
  "folder": "/path/to/work",            # working folder for every pane (relative: from here)
  "grid": {"rows": 1, "cols": 3},
  "panes": [
    {"slot": 1, "name": "plan", "title": "Planner", "color": "#D97757",
     "role": "planner", "program": "claude", "task": "optional per-pane task"}
  ]
}

Slots are numbered row by row from 1. Empty slots get a plain shell. --task goes to every
pane with a role; a pane's own `task` wins.
`role` (optional) names a herdr-core template, <templates>/<role>.md: its body is the role's
instructions and its `command` the default program. Without a template, `program` is required
and the role is only a label. Claude and Codex get the instructions and task as their first
prompt on the command line; other programs get them typed in with `hc send`.

Finds `herdr-app` and `hc` on PATH (or HERDR_APP / HC), templates in HC_TEMPLATES, else
%APPDATA%\\herdr-core\\templates on Windows, ~/.config/herdr-core/templates elsewhere, then
the example templates in templates/ next to this script.
Needs the Herdr window open.
"""
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

WINDOWS = os.name == "nt"
PROMPT_ARG = {"claude", "codex"}  # programs that take the first prompt as an argument
NAME_RE = re.compile(r"^[a-z0-9_-]{1,32}$")
COLOR_RE = re.compile(r"^#[0-9a-fA-F]{6}$")


def die(msg):
    print(f"error: {msg}", file=sys.stderr)
    sys.exit(1)


def find_tool(env, name, windows_default):
    if os.environ.get(env):
        return os.environ[env]
    found = shutil.which(name)
    if found:
        return found
    if WINDOWS and os.environ.get("LOCALAPPDATA"):
        p = Path(os.environ["LOCALAPPDATA"]) / "Programs" / windows_default
        if p.exists():
            return str(p)
    return None


def templates_dir():
    if os.environ.get("HC_TEMPLATES"):
        return Path(os.environ["HC_TEMPLATES"])
    if WINDOWS and os.environ.get("APPDATA"):
        return Path(os.environ["APPDATA"]) / "herdr-core" / "templates"
    return Path.home() / ".config" / "herdr-core" / "templates"


def read_template(role):
    # Your herdr-core templates first, then the examples next to this script.
    path = next((d / f"{role}.md" for d in (templates_dir(), Path(__file__).parent / "templates")
                 if (d / f"{role}.md").exists()), None)
    if path is None:
        return None, ""
    text = path.read_text(encoding="utf-8-sig")
    m = re.match(r"^---\r?\n(.*?)\r?\n---\r?\n?(.*)$", text, re.S)
    if not m:
        die(f"{path}: missing front matter")
    head = {}
    for line in m.group(1).splitlines():
        if ":" in line:
            k, v = line.split(":", 1)
            head[k.strip()] = v.strip()
    return head, m.group(2).strip()


def one_line(text):
    # One line, no double quotes: survives the shell the app starts agents in.
    return re.sub(r"\s+", " ", text).replace('"', "'").strip()


def codex_exe():
    # On Windows the npm `codex` shim goes through cmd, which mangles long prompts; use the binary.
    if WINDOWS and os.environ.get("APPDATA"):
        p = (Path(os.environ["APPDATA"]) / "npm" / "node_modules" / "@openai" / "codex" / "node_modules"
             / "@openai" / "codex-win32-x64" / "vendor" / "x86_64-pc-windows-msvc" / "bin" / "codex.exe")
        if p.exists():
            return str(p)
    return "codex"


def argv_for(program, prompt):
    if program == "codex":
        # Herdr starts Codex without the shared daemon, so each pane keeps its own session.
        return [codex_exe(), "--no-daemon", *([prompt] if prompt else [])]
    if program in PROMPT_ARG and prompt:
        return [program, prompt]
    return [program]


class Herdr:
    def __init__(self, dry):
        self.dry = dry
        self.app = find_tool("HERDR_APP", "herdr-app", Path("herdr-app") / "herdr-app.exe")
        self.hc_path = find_tool("HC", "hc", Path("herdr-core") / "hc.exe")
        if not dry and not (self.app and self.hc_path):
            die("herdr-app or hc not found (put them on PATH, or set HERDR_APP and HC)")

    def do(self, cmd, args):
        payload = json.dumps(args, ensure_ascii=False)
        if self.dry:
            print(f"[dry] herdr-app do {cmd} {payload}")
            return {"pane": f"<pane:{cmd}>", "terminal": f"<t:{cmd}>"}
        r = subprocess.run([self.app, "do", cmd, payload], capture_output=True, text=True, encoding="utf-8")
        try:
            out = json.loads(r.stdout or "{}")
        except json.JSONDecodeError:
            die(f"{cmd}: unexpected output: {r.stdout!r} {r.stderr!r}")
        if r.returncode != 0 or "error" in out:
            die(f"{cmd}: {out.get('error', r.stderr.strip())}")
        return out

    def pane_of(self, terminal):
        if self.dry:
            return f"<pane:{terminal}>"
        r = subprocess.run([self.app, "ls"], capture_output=True, text=True, encoding="utf-8")
        for sp in json.loads(r.stdout).get("spaces", []):
            for tab in sp.get("tabs", []):
                for t in tab.get("terminals", []):
                    if t.get("terminal") == terminal:
                        return t.get("pane")
        die(f"pane for {terminal} not found")

    def hc(self, args):
        if self.dry:
            print("[dry] hc " + " ".join(args))
            return
        r = subprocess.run([self.hc_path, *args], capture_output=True, text=True, encoding="utf-8")
        if r.returncode != 0:
            print(f"warning: hc {args[0]}: {r.stderr.strip()}", file=sys.stderr)


def plan_team(team, shared_task):
    rows, cols = int(team["grid"]["rows"]), int(team["grid"]["cols"])
    if not 1 <= rows * cols <= 12:
        die("grid must have 1..12 cells")
    panes = {int(p["slot"]): p for p in team["panes"]}
    plan = {}
    for slot in range(1, rows * cols + 1):
        p = panes.get(slot)
        if not p:
            plan[slot] = {"argv": None, "send": None, "labels": {}}
            continue
        name = p.get("name", "")
        if not NAME_RE.match(name):
            die(f"slot {slot}: name '{name}' must be 1-32 of a-z 0-9 - _ (put any language in 'title')")
        color = p.get("color", "")
        if color and not COLOR_RE.match(color):
            die(f"slot {slot}: color must be #rrggbb")
        role = p.get("role", "")
        head, body = read_template(role) if role else (None, "")
        program = p.get("program") or ((head or {}).get("command", "").split() or [""])[0]
        if not program:
            die(f"slot {slot}: no program (set 'program', or a role with a template)")
        # The shared --task goes to panes with a role; a plain shell gets only its own task.
        task = p.get("task") or (shared_task if role else "")
        prompt = one_line("\n\n".join(x for x in (body, task) if x))
        plan[slot] = {
            "argv": argv_for(program, prompt),
            "send": None if program in PROMPT_ARG or not prompt else prompt,
            "labels": {"team.name": team["name"], "team.slot": str(slot), "team.title": p.get("title", name),
                       "team.role": role, "team.color": color or (head or {}).get("color", "")},
        }
    return rows, cols, plan


def main():
    argv = sys.argv[1:]
    if not argv or argv[0] in ("-h", "--help"):
        print(__doc__)
        sys.exit(0 if argv else 1)
    dry = "--dry-run" in argv
    shared_task = ""
    if "--task" in argv:
        i = argv.index("--task")
        shared_task = argv[i + 1] if i + 1 < len(argv) else ""
    team = json.loads(Path(argv[0]).read_text(encoding="utf-8-sig"))
    rows, cols, plan = plan_team(team, shared_task)  # check everything before touching the app
    h = Herdr(dry)

    def launch(slot):
        a = plan[slot]["argv"]
        return {"argv": a} if a else {}

    folder = str(Path(team["folder"]).expanduser().resolve())  # relative: from where you run this
    first = h.do("space.new", {"name": team["name"], "folder": folder, **launch(1)})
    grid = {(0, 0): {"pane": h.pane_of(first["terminal"]), "terminal": first["terminal"]}}
    for c in range(1, cols):  # first row, left to right
        grid[(0, c)] = h.do("pane.split", {"direction": "right", "pane": grid[(0, c - 1)]["pane"], **launch(c + 1)})
    for c in range(cols):  # then each column downward
        for r in range(1, rows):
            slot = r * cols + c + 1
            grid[(r, c)] = h.do("pane.split", {"direction": "down", "pane": grid[(r - 1, c)]["pane"], **launch(slot)})

    for (r, c), cell in sorted(grid.items()):
        slot = r * cols + c + 1
        labels = [f"{k}={v}" for k, v in plan[slot]["labels"].items() if v]
        if labels:
            h.hc(["label", cell["terminal"], *labels])
        if plan[slot]["send"]:
            h.hc(["send", cell["terminal"], plan[slot]["send"]])
        print(f"slot {slot}: {cell['terminal']} {plan[slot]['labels'].get('team.title', '(shell)')}")


if __name__ == "__main__":
    main()
