# pi-pushtodisplay — Configuration & Onboarding Design (Draft)

> **Status:** DRAFT — under active iteration. This doc is the source of truth for the
> upcoming config refactor; it will be superseded by the README once implemented.

---

## 1. Problem statement (why not env vars today)

Current configuration is five environment variables read once at process start:

| Env var | Meaning | Default |
| --- | --- | --- |
| `PUSHTODISPLAY_BOARD_ID` | Board to send to | default board |
| `PUSHTODISPLAY_PANEL` | Panel (1–4) this agent writes to | `1` |
| `PUSHTODISPLAY_LABEL` | Friendly name on the panel | session name, then workspace folder |
| `PUSHTODISPLAY_STEPS` | `0` skips per-tool entries | on |
| `PUSHTODISPLAY_DISABLED` | `1` disables the extension | off |

Pain points driving this redesign:

1. **Per-process.** Every terminal/agent launch must carry its own env vars, by hand, every time. Nothing persists.
2. **Invisible & undiscoverable.** After launch there is no record of what each agent claimed; `PUSHTODISPLAY_PANEL=9` is silently ignored (falls back to 1), so agents can land on a panel you did not intend.
3. **Subagent inheritance is unpredictable.** Children inherit the parent's env — either every subagent in a session shares one panel or each must be launched differently.
4. **Not editable.** No "what's configured, and why" view; no way to re-aim a running session.
5. **Pollutes the environment namespace.** Config about *this workstation's display wiring* doesn't belong on every process.

### Guiding principles

- **Workstation-bound config.** Which display/board/panel this machine's agents feed is a property of the *workstation + identity*, not of the code in a repo. Config files must not be injected into workspace/repo folders.
- **Pi-native identity.** pi already has a first-class per-process identity that is not an env var: the **session name** (`pi --name <name>` at launch, `/name <name>` or Ctrl+R in the TUI, `session_info_changed` events to extensions). Use it.
- **Zero config to start.** Fresh install + default board + panel 1 must work with no files.
- **Passive mirror, minimal nagging.** Onboarding is: authenticate → land somewhere sane → make the mapping visible & editable. No wizards.
- **Backward compatible.** Existing `PUSHTODISPLAY_*` usage keeps working, demoted to an emergency override.

---

## 2. Behavior baseline (what does NOT change)

These stay exactly as implemented today:

- **Board model.** A panel is a shared scrolling log (1–4). Each entry is its own message, newest at the top; several agents may write to one panel, and every line starts with the agent name. A line is four inline runs on a fixed surface, and status colour groups the event (blue = up, green = worked, amber = needs you, red = failed, grey = nothing happening).
- **Event-driven updates.** One pi event becomes one message; there is no per-panel state frame. `session_start` (READY), `session_info_changed` (renamed), `before_agent_start` (task), `tool_execution_end` (step OK/FAIL), `message_end` (provider error), `ui_prompt_start` (NEEDS), `agent_settled` (DONE/STOP), and `session_shutdown` (ENDED) post; `tool_execution_start` only records args, and `turn_start`/`ui_prompt_end` post nothing. Users never call the extension from prompts.
- **Auth.** OAuth 2.0 device-code via the bundled `pushtodisplay` CLI; credentials are stored in the OS keychain (macOS Keychain, Linux libsecret, Windows Credential Manager), with a plaintext fallback at `~/.config/pushtodisplay/credentials.json` only when no keychain is available. The access token auto-refreshes. The first probe is awaited; once auth is known to be bad, updates are dropped (never buffered). Re-probes are lazy on send, at most once per 20 s; `/pushtodisplay-status` forces one and `/pushtodisplay-login` re-enables sending.
- **Rate limiting & quota.** Sends are strictly ordered and spaced ≥ 1.2 s; consecutive duplicates are suppressed; the backlog is bounded (oldest steps dropped); every send counts toward the account's monthly message quota. There is no coalescing.
- **Panel validation.** `panel` must be an integer 1–4; otherwise falls back to 1. (Now applied to whichever layer supplied the value.)
- **Commands** `/pushtodisplay-login`, `/pushtodisplay-status`, `/pushtodisplay-test`, `/pushtodisplay-clear` (see §5 for the added one).
- **CLI resolution.** Bundled npm dependency first, PATH binary fallback.

---

## 3. Target config model

All configuration lives in **one workstation-scoped file**: `~/.pi/pushtodisplay.json`.

```jsonc
// ~/.pi/pushtodisplay.json
{
  // Built-in fallback for everything.
  "defaults": { "boardId": "", "panel": 1, "label": "" },

  // Per-directory (longest-prefix match wins), for "different folder → different target".
  // Example paths — replace these with your own absolute paths.
  "directories": {
    "/Users/you/work/jar":    { "boardId": "bt_...jar...",  "panel": 2 },
    "/Users/you/work/salt":   { "boardId": "bt_...salt...", "panel": 3 },
    "/Users/you/work":        { "boardId": "bt_...ops..." }
  },

  // Per-session-name, for "same folder, new terminal → different target".
  // Bare names apply everywhere; a name nested under a directory applies
  // only inside that directory (see §3.1, §3.2).
  "sessions": {
    "qa":      { "panel": 4, "label": "qa" },
    "release": { "panel": 2, "label": "release" }
  }
}
```

### 3.1 Sections and semantics

| Section | Key | Meaning |
| --- | --- | --- |
| `defaults` | global fallback | Applied when nothing more specific matches. |
| `directories` | absolute folder path | Target for sessions started in that folder (`ctx.cwd`). Not limited to git repos — any folder works. **Longest-prefix wins**, so `~/work/jar` refines `~/work`. May also contain a nested `sessions` map (see below). |
| `sessions` | session name | Target for sessions whose name matches (`pi --name qa`, `/name qa`). A `sessions` map may appear at **top level** (name applies anywhere) or **nested under a `directories` entry** (name applies only inside that directory). |

All keys are optional; `{ boardId, panel, label }` merge per-key (an entry specifying only `panel` leaves `boardId`/`label` from the next layer). Unknown keys are ignored with a warning.

Resolution of a session *inside a directory* is by the most specific key (see §3.2): a directory-scoped name beats a bare name beats a bare directory.

### 3.2 Resolution ladder

```
 1. environment vars                 (emergency/CI override only; wins over all files)
 2. directories.<dir>.sessions.<name>   (session name scoped to its directory)
 3. sessions.<name>                     (session name anywhere)
 4. directories.<longest prefix of cwd> (any session in this directory)
 5. defaults
```

Rule of thumb for users: **the closer to the running agent, the higher the priority; env vars are the "right now" override.** Session names are *global by default* — `session1` means the same target everywhere, unless a directory nests a `sessions.session1` override; that scoped entry wins only inside its directory.

### 3.3 Identity resolution (how the extension knows which agent it is)

| Signal | Source | Used for |
| --- | --- | --- |
| `pi.getSessionName()` + `session_info_changed` | `pi --name` / `/name` / Ctrl+R rename | `sessions` lookup; default label |
| `ctx.cwd` | process cwd | `directories` longest-prefix lookup |
| workspace folder basename | `ctx.cwd` basename | fallback label |

**Subagents (open item):** pi core does not hand the extension "my agent name is `release`";
children get the name via the harness, not the extension context. If the agent name is
observable from a child process (env it sets, a runtime file, or a session path), we read it
and use it for the `sessions` lookup; otherwise a child resolves like any other session
(cwd + its own session name). **This is the only fuzzy part — a spike during implementation
will confirm what pi-subagents / workflow children expose.**

---

## 4. Behavior per scenario (expected outcomes)

| Scenario | Expected behavior |
| --- | --- |
| Fresh install, no config, no login | One notice: "not authenticated — run /pushtodisplay-login". Updates dropped until login. |
| Fresh install, logged in, no config | Works out of the box: default board, panel 1, label = session name, else workspace folder. One-time notice: "sending to your default board, panel 1 — /pushtodisplay-status to check, /pushtodisplay-config to change." |
| Work in `~/work/jar` | Resolves `directories` entry → jar board, panel 2 (etc.). |
| Same folder, second terminal, unnamed | Same directory target as the first; both write to the same panel (see §7). |
| Same folder, second terminal, `pi --name qa` | `sessions.qa` wins → panel 4, label "qa", possibly different board. **The supported way to differentiate same-folder agents.** |
| Same session name in two folders (`session1` in dir1 and dir2) | Both hit bare `sessions.session1` → same target by default (deterministic). To differ, nest a `sessions` override under the `directories[<dir2>]` entry. |
| `/name release` mid-session | `session_info_changed` → target re-resolved live; subsequent updates go to the new target. Previously posted entries remain on the old panel. |
| Tool fails | A `FAIL` entry is posted for that step; the rest of the log is unchanged. |
| Repo has no `.pi/` config | Irrelevant — we deliberately read nothing from the repo (§3, §8). |

---

## 5. Commands

| Command | Behavior |
| --- | --- |
| `/pushtodisplay-login` | *(unchanged)* OAuth device-code login. |
| `/pushtodisplay-status` | *(unchanged)* Auth state. |
| `/pushtodisplay-test` | *(unchanged)* Test entry wiring check. |
| `/pushtodisplay-clear` | *(unchanged)* Write a `log cleared` entry to this panel. |
| `/pushtodisplay-config` | *(new)* Show the **resolved** target with its source for each key, and let the user set/change targets interactively. **Takes a scope selector** (§5.1) — aimed at session *or* folder *or* workstation — and persists to `~/.pi/pushtodisplay.json`. |

### 5.1 `/pushtodisplay-config` — scope selector

The config file has four scopes, so the command must target all of them — hand-editing JSON is not an acceptable path for any of them:

```
/pushtodisplay-config
  → Which scope?
    [1] this session           → writes directories.<cwd>.sessions.<name>   (name, only in this folder)
    [2] this session anywhere  → writes sessions.<name>                    (name, every folder)
    [3] this folder            → writes directories.<cwd>                  (every session in this folder)
    [4] everywhere             → writes defaults                           (whole workstation)
  → pick board (by name, from the user's board list)
  → pick panel 1–4
  → label (optional)
  → writes the file, then shows the RESOLVED target with the source of each key
```

| Scope choice | Writes to | Effective where |
| --- | --- | --- |
| this session | `directories.<cwd>.sessions.<name>` | only this (folder, name) pair |
| this session anywhere | `sessions.<name>` | that name in every folder |
| this folder | `directories.<cwd>` | every session launched in this folder |
| everywhere | `defaults` | the whole workstation, unless overridden |

Rules:

- **Unnamed session:** if the session has no name, scope 1/2 have no key to write — the command says so and offers scope 3 (folder) instead.
- **Writes don't delete:** setting one scope leaves other scopes untouched, so after writing, the command prints the **merged resolved target with per-key sources** (e.g. "board ← this folder entry, panel ← written just now"). Without this, the "invisible config" complaint from §1 resurfaces.
- **`--unset`:** removes the current scope's entry (or the boardId/panel/label keys given).
- **Non-interactive form:** `/pushtodisplay-config <scope> --board <n|name> --panel <1-4> [--label <t>] [--unset ...]` so `-p`/CI runs aren't locked out of the TUI menu.
- **Board selection by name:** the extension lists the user's boards (via the bundled CLI) and resolves the chosen name to its `bt_...` ID — the user never types or sees the ID in the happy path. The `bt_...` string appears in `/pushtodisplay-status` output (with board names), the dashboard, and `pushtodisplay boards list` for the hand-editing path.
- **Panels need no lookup:** panels are just positions 1–4 in the board's 2×2 grid; choosing a number is all there is (§4).

### 5.2 User journey (canonical walkthrough)

```
# install + login (existing)
pi install npm:pi-pushtodisplay
/pushtodisplay-login

# see where you currently land: auth state, resolved target with sources,
# and the board list with IDs (new status output)
/pushtodisplay-status

# verify wiring (existing)
/pushtodisplay-test

# aim a scope (new) — or edit ~/.pi/pushtodisplay.json by hand using the
# bt_... ID shown by /pushtodisplay-status, the dashboard, or the CLI
/pushtodisplay-config
```

The happy path never exposes the `bt_...` ID; it only appears in status output and the hand-editing path.

---

## 6. Runtime semantics

- **When config is loaded:** at session start. `session_info_changed` (rename) re-resolves the target for subsequent sends. Config file edits require a restart or `/name` re-trigger — no file watcher in v1 (Open Decision C).
- **Disabled:** resolves through the same ladder (`sessions.<name>.<disabled>` etc.). When disabled, the extension registers no handlers — same as today's early return.
- **Auth gating unchanged:** the first probe is awaited; once auth is known to be bad, updates are dropped; sending resumes after login.
- **Static conflict detection:** at startup, warn once if the *resolved config file* contains two entries that resolve to the same board+panel for the same session scope (e.g. two directory entries overlapping inside one machine's config). Cross-process target conflicts are not detectable (see §7).

---

## 7. Known limits (expected, documented)

- **No cross-process visibility.** The extension cannot see other pi processes, so two *unnamed* sessions in the same folder resolving to the same panel will interleave their entries; the agent field keeps their lines apart, but the sharing is silent. Mitigation: (a) per-directory distinct default panels, (b) name your sessions (`pi --name qa`), (c) `/pushtodisplay-config` makes the resolved target visible so unintended sharing is user-detectable.
- **No file watcher in v1.** Config edits apply on next session start (or `/name`).
- **Extension cannot self-invoke commands.** Onboarding copy must tell the *user* which command to type — pi platform constraint.

---

## 8. Explicitly out of scope for v1 (maybe v2)

- **Repo/workspace config injection** (`.pi/` files, agent `.md` frontmatter, committed team defaults) — **retracted from earlier proposals.** The target mapping is identity/machine-bound; repo files would collide across machines and trigger pi's project-trust prompts.
- **Team-shared `profiles`** — a copyable config block so a team can share "the jar board" without committing config; deferred (document the copy-paste pattern instead).
- **Cross-process registry / lock files** for true target-conflict detection.
- **Env-var removal** — see Open Decision B.

---

## 9. Open decisions (need input before implementation)

- **A. `/pushtodisplay-config` persistence:** **RESOLVED — persist.** §5.1: scope selector (session / session-anywhere / folder / everywhere) + `--unset` + non-interactive form. Boards picked by name and resolved to IDs.
- **B. Env vars:** keep `PUSHTODISPLAY_*` as a documented emergency/CI override, or cut them entirely for v1 cleanliness (CI can use `pi --name qa -p "cmd"`)?
  - **Default stance:** keep, documented last, supported for backward compatibility.
- **C. Reload policy:** config read once at session start only, or also re-read on resume/`session_info_changed`? (Default: read at start, re-resolve on session name change; no watcher.)
- **C2. Directory-scoped session names (proposed):** resolve `directories.<dir>.sessions.<name>` before bare `sessions.<name>`, so a name nested under a directory overrides the global meaning of that name only there. Alternative: flat global names only ("a name always means one target; use different names per folder"). Default stance: proposed scoped model — confirm.
- **D. Subagent identity:** confirm what subagent harnesses expose to child processes (spike), then decide whether `sessions` lookup keys off agent name when available.
- **E. Label semantics:** when a `sessions`/`directories` entry does not set `label`, label = session name, then workspace folder (today). Confirm we keep that default over static config.
- **F. Directory matcher details:** exact path only vs. prefix match; confirm longest-prefix choice; decide symlink/canonical handling (use `realpath`?).

---

## 10. Compatibility & testing

- **Backward compatibility:** all five `PUSHTODISPLAY_*` vars continue to work exactly as today (they become the top override). Existing tests for `loadConfig` stay meaningful (env layer still parsed and validated).
- **New tests:**
  - Ladder: env > scoped session > session > directory-prefix > defaults, with per-key merge across layers.
  - Longest-prefix directory matching (including `~/work` + `~/work/jar` nesting, non-git folders).
  - Session rename (`session_info_changed`) re-aims subsequent payloads to the new target.
  - Panel validation applied per layer (bad value in any layer → falls back to 1... *or* to defaults — see note).
  - Static conflict warning for same board+panel within one config.
  - `disabled` resolution through the ladder.
- **Doc updates required:** README configuration section rewritten (workspace config file, `--name` pattern, `/pushtodisplay-config`); env vars moved to an "Emergency override" subsection. This design doc collapses into the README on implementation.

> Note on fallback for invalid panel: decide whether a bad `panel` in a *specific* layer marks that layer as "not set" (falls through to defaults) or as "use 1". Recommend: fall through to next layer, keeping 1 as the final built-in default.

---

© 2026 Goban Source, LLC. Push To Display is a product of Goban Source, LLC —
see [pushtodisplay.com](https://pushtodisplay.com).