# Changelog

All notable changes to **pi-pushtodisplay** are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-11-05

Panel output was rebuilt around what the board actually does, which is not what
this package assumed.

### The rendering model was wrong

The board renders each message as **one wrapping paragraph**: `blocks` are
inline runs (like `<span>`), not lines (like `<p>`). This package was posting
3-5 blocks per update and the panel rendered them as a single run-on sentence
("● release WORKING · 4m12s 🎯 refactor … turn 6 · 14 tools"). Caught by the
maintainer; ground truth is the app's `DisplayBlocks.tsx`.

### Changed

- **A panel is a log, not a status card.** Each update is now one message and
  the panel keeps history, so one entry is posted per tool step, in order.
  `renderPanel()` and the status/colour state machine are gone.
- **One line per entry**: `<agent> <what happened> <STATUS> <time>`.
  The agent name leads so a shared panel reads as one column per agent; the
  event follows, and the status and clock trail as a stamp.
- **One type size, one weight.** Size and weight are left at the renderer's
  defaults (`medium` / regular); hierarchy comes from the four colours and the
  upper-case status, which is what makes `FAIL` findable in a column of entries.
- **Three bodies are shortened, by structure before characters.** Tool
  descriptions get 48 characters and over-budget ones are *summarised* (a long
  command keeps its program and subcommand, a long path drops its directory
  before its file name, a file name keeps its extension). The prompt and the
  result share one rule — first usable sentence, then a word-boundary cap at
  60 — because both are free text we did not write, and a pasted paragraph
  would otherwise push the rest of the log off the panel.
- **Closed status vocabulary**: `READY`, `RUN`, `OK`, `FAIL`, `NEEDS`, `DONE`,
  `STOP`, `ENDED`. No icons.
- **No separator glyph**: a `·` between fields added noise and, worse, could wrap
  to the start of a line on its own.
- **Steps post when they finish**, not when they start, so a line states what
  actually happened instead of leaving a stale `running` behind it. The args are
  kept per `toolCallId` for the duration of the call only.
- **Eight events speak:** session open, session rename, a new task, a finished
  tool, a provider error, a blocking prompt, the end of a run, and the session
  close. `tool_execution_start` only records args; `turn_start`, `ui_prompt_end`,
  and normal `message_end` chatter post nothing.
- **No more coalescing.** Superseding the previous frame was right for a status
  card and wrong for a log: it discarded entries. `src/sender.ts` keeps strict
  order, suppresses consecutive duplicates, and trims the oldest *steps* when
  the backlog would run too far behind. Milestones and results are never dropped.
- **Agent name resolves to `PUSHTODISPLAY_LABEL`, then the pi session name, then
  the workspace folder** — an explicit label wins, and the folder is the last
  resort because generated session ids mean nothing to a person.

### Layout

- **Bodies have fixed budgets.** Tool descriptions get 48 characters; prompts
  and results get 60. Long commands and paths are summarised before any
  character cut, so the identifying part survives.
- **Long things are summarised, not sliced.** Commands keep the program and its
  subcommand (`running grep`, `npm test`); absolute paths outside the cwd and
  `$HOME` keep the file name and extension (`…/pasted-image-2026….png`); prompts
  have their pasted paths shortened before any truncation happens.
- **Truncation prefers word boundaries** and never leaves an extension off a
  file name.
- **`DONE` quotes the agent's own closing text**, shortened to its first usable
  sentence, instead of reporting counters. `ran 5 tools` / `finished in 6s` told
  a reader nothing; the closing line is the actual result. Markdown headings and
  code fences are stripped first, and the prompt gets the same prose treatment.

### Added

- **A session is bracketed by two lines**, on every open and every close,
  reloads included: `session opened READY` / `session closed ENDED`. Removing
  them left a board where a finished agent, a killed one and one stuck in a
  four-minute test looked identical. They carry no counters — the panel explains
  its own silence, it does not report usage.
- `READY` and `ENDED` join the status vocabulary, coloured by category rather
  than by identity: blue = up, green = worked, amber = needs you, red = failed,
  grey = nothing happening.

### Cleanup

- **The session summary line is gone.** `6 tools, 3 failed, 12s END` was the last
  counters dump on the board, kept alive only because a "summary frame" once
  existed. A session ending is machinery; the last `DONE` already ends the story.
  With it went `summaryMessage`, `formatElapsed`, `touchedPath`, and the state
  that fed them — `startedAt`, `toolCount`, `files`, `failed` — leaving
  `PanelState` at four fields: `agent`, `cwd`, `task`, `closing`.

- **"Gave up after 3 failures" is gone.** That verdict dates from when the panel
  was a status card that had to decide whether to turn red; a log reports each
  step's `FAIL` on its own line and does not need a second-order opinion about
  the run. It was also wrong whenever failures were transient — three failed
  commands followed by a normal answer ended `FAIL 3 failures in a row`.
  `outcome()`, `failureReason()`, `FAIL_ALERT_THRESHOLD`, the `failures`
  counter and `failedMessage()` are all removed.

- **`lastToolFailed` is gone, and with it a real bug.** "Did the run fail?" was
  inferred from whichever tool finished last; with parallel tool calls that is a
  fact about ordering, not about the run, so a successful turn could report
  `FAIL bash failed`. Each failed step is now reported on its own line; there is
  no second-order verdict about the run.
- **Two queues became one.** `Outbox` and `RateLimiter` each owned a queue, a
  drain loop, a `pending` and a `flush()`, with the outbox awaiting the limiter
  so one queue was always length ≤ 1. `src/sender.ts` is one loop that keeps the
  same behaviour: order, enqueue-time dedupe, bounded backlog, 1.2 s spacing
  measured from the end of the previous send.
- **`turn_start` is no longer subscribed** — it only fed a counter nothing read.

### Styling

- **Each entry is four inline runs on a fixed surface.** Agent name `#5ec8d4`,
  body `#f2f6f9`, status coloured by kind, time `#808c99`, all on `#1b2430`.
- **The surface is hard-coded, not themed.** The board may be in a light or dark
  theme and the extension cannot detect which (`resolveBlockTextColor` falls back
  to `theme.textPrimary` only when no colour is set), so the entry carries its own
  contrast: it reads as a card on white and a lifted tile on black. A vivid accent
  that survived both themes on a transparent row is arithmetically impossible —
  only mid-greys pass on white *and* black.
- **`palette.test.ts` measures the palette.** Every foreground is checked against
  the surface at ≥ 4.5:1, so a future colour change cannot quietly ship an
  unreadable line.

### Added

- **Provider errors are reported.** pi surfaces a failed model call as an
  assistant message with `stopReason: "error"` and `errorMessage`; that was
  ignored, so real failures were invisible on the board. They now post a `FAIL`
  line with the provider's own text.
- **`STOP` is distinct from `FAIL`** — pressing Escape is not the agent failing.
- `PUSHTODISPLAY_STEPS=0` posts milestones only (session open/close, tasks,
  results, alerts) instead of one entry per tool step.
- `/pushtodisplay-clear` writes a `log cleared` entry.

### Fixed

- **An aborted run posted a false `FAIL`** — pi reports the abort itself as an
  assistant message with `stopReason: "error"` ("This operation was aborted"),
  so pressing Escape produced both `FAIL` and `STOP` for the same run. Error
  lines are now held until `agent_settled` and dropped when the run was aborted;
  a real provider error still posts before `DONE`.
- **The extension failed to load, unregistering every slash command** — the
  factory resolved the agent name with `pi.getSessionName()` while pi had not
  bound the extension runtime yet. That call throws, and pi discards the whole
  factory on a throw, so all four `/pushtodisplay-*` commands vanished. Agent
  identity is now read lazily at session start (explicit label, then session
  name, then working directory), and `src/__tests__/extension-load.test.ts`
  reproduces pi's gated runtime stubs so this class of bug fails CI instead of
  failing silently.
- **Failure entries blamed the wrong tool** — the reason used the most recently
  *started* tool rather than the one that failed, so a failure in `bash`
  followed by an `edit` was reported as "edit failed".
- **Two agents posting the same sentence could erase one another** — duplicate
  suppression now fingerprints the whole line including the agent field.
- **`/pushtodisplay-test` could report "not authenticated" right after a
  reload** — it trusted the cached `authed` flag while the `session_start` probe
  was still in flight. It now probes on demand.
- **Entries could be lost on exit** — `session_shutdown` now awaits the sender
  flush, and posts the closing `ENDED` line for every shutdown reason, reloads
  included.
- **Updates bypassed auth gating** — the dispatch path now checks auth for every
  send, so nothing is attempted while logged out.
- Removed the unbounded `toolCallId → args` growth (the map is now bounded and
  entries are deleted when the call ends).

### Docs

- README and SKILL now describe the inline-block rendering model, the shared
  panel, and the four-field line format.

### Dependencies

- `@earendil-works/pi-coding-agent` dev dependency bumped to `^1.5.0` for the
  `ui_prompt_start`, `session_info_changed`, and `agent_settled` APIs.

## [0.1.1] - 2026-08-24

### Changed

- **Accurate auth gating** — `cli-adapter.authStatus()` now reads
  `auth status --json` and the exit code, so an expired access token with a
  valid refresh token no longer looks like "not authenticated" (the CLI
  refreshes it transparently). Falls back to legacy text heuristics for older
  installed CLIs.
- **Bundled CLI updated** — dependency range bumped to `pushtodisplay ^0.1.15`
  (auth status now reports effective auth and exits non-zero when not
  authenticated).

## [0.1.0] - 2026-08-22

First release as a standalone pi package. Promoted from the in-house
`~/.pi/agent/extensions/pushtodisplay.ts` extension.

### Added

- **Self-contained CLI resolution** — the `pushtodisplay` CLI (OAuth
  device-code flow, token auto-refresh) is now a bundled npm dependency, so
  `pi install` works without a global install; falls back to a PATH binary.
- **Clear diagnostics** — helpful notify when the CLI is missing, and accurate
  auth-failure vs network-error classification.
- **Modular architecture** — `config`, `payloads`, `rate-limiter`,
  `cli-adapter`, `describe` split out of the single-file extension.
- **Serialized rate limiting** — sends are strictly spaced ≥ 1.2 s apart (was
  racy under concurrent sends), while keeping per-panel coalescing.
- **Test suite** — 41 unit tests (config, payloads, rate limiter, CLI adapter,
  tool descriptions) with coverage thresholds.
- **Agent skill** — `pushtodisplay` skill so pi agents can help users install,
  configure, and use the package.
- **CI + publish workflows** — typecheck/lint/test on push, release workflow
  mirroring the CLI repo (stable/alpha/beta/rc, npm provenance).

### Changed

- Session end summary now reports the session reason from
  `session_shutdown` (was hardcoded to `quit`).
- `index.ts` is the package extension entry (was `pushtodisplay.ts`); all
  pi-facing behavior (events, commands, auth gating, payloads) is unchanged.