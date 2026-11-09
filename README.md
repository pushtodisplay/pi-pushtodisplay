# pi-pushtodisplay

**Push To Display** extension for [pi](https://pi.dev) — mirrors your agent's activity onto your Push To Display board in real time.

A panel is a **shared scrolling log** (1 of 4). Every entry is its own message,
newest at the top, and every entry has the same shape:

```
<agent> <what happened> <STATUS> <time>
```

```
pi-pushtodisplay session closed ENDED 12:10
pi-pushtodisplay Pinned the clock so the release test passes. DONE 12:09
pi-pushtodisplay Allow bash: git push --force-with-lease NEEDS 12:08
pi-pushtodisplay reading src/payloads.ts OK 12:08
pi-pushtodisplay running grep FAIL 12:07
pi-pushtodisplay running ls -1 src OK 12:07
pi-pushtodisplay test with some dummy turns. RUN 12:06
pi-pushtodisplay session opened READY 12:06
```

Three things get shortened, and each is shortened *by structure* first:

| Body | Rule |
| --- | --- |
| tool description | 48 characters; a long command keeps its program and subcommand (`running grep`), a long path drops its directory before its file name |
| prompt | first usable sentence, 60 characters, ellipsis at a word boundary when possible |
| result | same rule as the prompt |

The agent name leads, so a shared panel reads as one column per agent; the
event follows, and the status and clock trail. A line is four inline runs on a
fixed dark surface (`#1b2430`): the name is teal, the body near-white, the
status has its own colour, and the time is dimmed. Type size and weight are the
renderer's defaults; the upper-case status is what makes a line scannable.

## What gets posted

| Event | Entry | Status |
| --- | --- | --- |
| the session opens | `session opened` | `READY` |
| the session is renamed | `session renamed` | `READY` |
| a prompt arrives | `<task>` | `RUN` |
| a tool finishes | `running npm test` | `OK` / `FAIL` |
| a blocking prompt opens | `Allow bash: git push` | `NEEDS` |
| the run finishes | `<what the agent said>` | `DONE` |
| you pressed Escape | `interrupted before it finished` | `STOP` |
| the session closes | `session closed` | `ENDED` |
| the model/provider failed | `HTTP 500 …` | `FAIL` |

The status word is a **closed** vocabulary — `READY`, `RUN`, `OK`, `FAIL`,
`NEEDS`, `DONE`, `STOP`, `ENDED` — so a line can never invent its own state, and
there is no icon to decode. `READY` and `ENDED` bracket a session: silence alone
cannot distinguish a finished agent from a killed one, so the panel says when it
opens and when it closes, reloads included.

Steps are posted when they **finish**, so a line states what actually happened
instead of leaving a stale "running" behind it. The rest is deliberately silent:
a turn boundary, the agent's mid-run chatter, and a prompt being answered are
facts about machinery, not news.

**The result line quotes the agent.** Counters ("ran 5 tools", "finished in 6s")
answer a question nobody asked, so `DONE` carries the agent's own closing text,
shortened to its first usable sentence. It gets the same prose treatment as the
prompt; tool descriptions are summarised separately.

## Features

- **Reads like English** — every entry is a sentence (`running npm test`, `editing src/auth.ts (+8 −3)`). Paths are shortened against the session cwd.
- **A trail, not a status card** — one entry per finished tool step, in the order it happened. `/pushtodisplay-clear` writes a `log cleared` entry; `PUSHTODISPLAY_STEPS=0` drops the per-step entries if you only want milestones.
- **Failures are reported, never inferred** — a failed step says `FAIL` on its own line; a provider error says what the provider said; `STOP` means you pressed Escape. There is no "the run failed" verdict to contradict a turn that finished, and no threshold that decides one.
- **Order is preserved** — nothing is reordered, so a result is never sent ahead of the step that caused it. Consecutive duplicates are suppressed, and the backlog is bounded, so the log cannot fall minutes behind the agent.
- **OAuth-only auth** — no API keys. Reuses the `pushtodisplay` CLI's device-code flow; tokens auto-refresh.
- **Quota-friendly** — every API call counts toward your message quota (Sandbox tiers are rate-limited to ~1 msg/s). Sends are spaced ≥ 1.2 s, consecutive identical lines are skipped per agent, and nothing streams token by token.
- **Auth gating** — updates wait for the first auth probe, then are dropped (never buffered) while auth is known to be bad; sending resumes automatically once you log in.
- **Self-contained install** — bundles the `pushtodisplay` CLI as a dependency, so `pi install` works without a global CLI. Falls back to a `pushtodisplay` binary on PATH.

## Install

> **Security:** Pi packages run with full system access. Review the source before installing third-party packages.

```bash
pi install npm:pi-pushtodisplay          # from npm
pi install git:github.com/pushtodisplay/pi-pushtodisplay   # from git
pi install /path/to/pi-pushtodisplay     # local checkout (run `npm install` first)
```

Project-scoped (shared via `.pi/settings.json`):

```bash
pi install -l npm:pi-pushtodisplay
```

The package carries the `pi-package` keyword, so npm releases are indexed by the
[Pi package catalog](https://pi.dev/packages/pi-pushtodisplay) automatically;
there is no separate submission step.

**Requirements:** Node.js ≥ 18. The `pushtodisplay` CLI is installed automatically as a dependency. If you already have a global `pushtodisplay` binary (e.g. `npm i -g pushtodisplay`), it's used as a fallback.

## Quick start

1. **Log in** (opens your browser, OAuth device-code flow):

   ```
   /pushtodisplay-login
   ```

2. **Verify the wiring** — sends a test entry to your configured panel and board
   (panel 1 / the default board unless overridden):

   ```
   /pushtodisplay-test
   ```

3. **Check auth state**:

   ```
   /pushtodisplay-status
   ```

That's it — the next time you run an agent, your board shows it starting, what it's working on, errors, and when it ends.

## Configuration

| Env var | Default | Description |
| --- | --- | --- |
| `PUSHTODISPLAY_BOARD_ID` | *(default board)* | Board ID to send to. |
| `PUSHTODISPLAY_PANEL` | `1` | Which panel (1–4) this agent writes to. |
| `PUSHTODISPLAY_LABEL` | *(session name, then workspace folder)* | Agent name in the first field of every line. |
| `PUSHTODISPLAY_STEPS` | *(on)* | Set to `0` to skip per-tool entries (milestones only). |
| `PUSHTODISPLAY_DISABLED` | *(off)* | Set to `1` to disable the extension entirely. |

### Multiple agents / panels

Give each parallel agent its own panel and a label:

```bash
# agent A
PUSHTODISPLAY_PANEL=1 PUSHTODISPLAY_LABEL=cicd pi

# agent B
PUSHTODISPLAY_PANEL=2 PUSHTODISPLAY_LABEL=qa pi
```

Each panel becomes its own scrolling log, so you can see what every agent did and
which one needs you. Sharing a panel between agents is fine — the agent field on
every line keeps them apart:

```
qa Allow bash: git push NEEDS 11:41
release running npm test OK 11:40
```

> **TIP:** with no explicit `PUSHTODISPLAY_LABEL`, the label is the session name
> when one is set, otherwise the workspace folder name; launching from two
> different repos already gives you two distinct agents.

## Commands

| Command | Description |
| --- | --- |
| `/pushtodisplay-login` | Start OAuth login (opens browser, shows code). |
| `/pushtodisplay-status` | Show current auth state. |
| `/pushtodisplay-test` | Send a test update to verify wiring. |
| `/pushtodisplay-clear` | Write a `log cleared` entry to this panel. |

## How it works

```
pi events ──► state ──► message builder ──► sender ──► CLI ──► API
(session/task/  (panel-state)  (messages.ts,      (ordered,   (1.2s spacing)  (OAuth)
 tool/message/                   one sentence)     bounded,
 ui-prompt)                                        deduped)
```

- **Events listened to:** `session_start`, `session_info_changed`, `before_agent_start`, `tool_execution_start`, `tool_execution_end`, `message_end`, `ui_prompt_start`, `agent_settled`, `session_shutdown`.
- **Messages, not state:** `src/messages.ts` turns one event into one sentence. There is no "current status" object to render — `PanelState` is four fields (`agent`, `cwd`, `task`, `closing`).
- **No coalescing:** every entry is news, so nothing is dropped for being superseded.
- **One queue, four jobs:** `src/sender.ts` keeps strict order, suppresses consecutive duplicates, trims the oldest steps when the backlog would otherwise run too far behind, and spaces sends ≥ 1.2 s apart — safely above the Sandbox ~1 msg/s cap.
- **Auth gating:** auth is probed at session start, and re-probed lazily on send at most once every 20 s while unauthenticated (`/pushtodisplay-status` forces a check). Once auth is known to be bad, updates are dropped, never buffered; `/pushtodisplay-login` re-probes and re-enables sending. Gating happens at dispatch time, so every path is covered.
- **CLI resolution:** the bundled `pushtodisplay` npm dependency is located via the extension's own `node_modules` (no global install needed); falls back to PATH.

## Development

```bash
npm install
npm run check        # typecheck + lint + test
npm test -- --coverage
```

The package is plain TypeScript — pi loads `index.ts` directly (no build step). Unit tests live under `src/__tests__/`.

## Release

The first npm publish is a one-time authenticated step; later releases run from
the [publish workflow](https://github.com/pushtodisplay/pi-pushtodisplay/blob/main/.github/workflows/pi-pushtodisplay-publish.yaml)
with npm Trusted Publishing (OIDC) and provenance. See
[docs/publishing.md](https://github.com/pushtodisplay/pi-pushtodisplay/blob/main/docs/publishing.md)
for the exact first-publish commands, the Trusted Publisher fields for this
repository, and the verification steps.

After the first publish, the package is installable with
`pi install npm:pi-pushtodisplay` and appears in the
[Pi package catalog](https://pi.dev/packages/pi-pushtodisplay).

## Architecture

| File | Responsibility |
| --- | --- |
| `index.ts` | Package entry — resolves the bundled CLI, exports the factory. The only file using `import.meta`. |
| `src/extension.ts` | The factory: pi event/command wiring, auth gating, send scheduling. |
| `src/config.ts` | Env-var config parsing + string helpers (`truncate`, `clock`). |
| `src/panel-state.ts` | The task/closing text a message needs; no counters, no verdict. |
| `src/messages.ts` | One-sentence message builders — the whole visible vocabulary. |
| `src/sender.ts` | The queue: order, dedupe, bounded backlog, 1.2 s spacing. |
| `src/payloads.ts` | Wire types and the palette. |
| `src/auth-gate.ts` | Unknown / logged in / logged out; unknown waits for the probe, known-bad drops. |
| `src/cli-adapter.ts` | CLI binary resolution, argv mapping, auth probing, error classification. |
| `src/describe.ts` | Human-readable present-tense one-liners for tool calls. |

## License

MIT. PushToDisplay is a product of Goban Source, LLC — see [pushtodisplay.com](https://pushtodisplay.com).