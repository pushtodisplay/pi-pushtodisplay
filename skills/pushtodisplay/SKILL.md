---
name: pushtodisplay
description: >-
  Help the user use the pi-pushtodisplay pi package — what it does, how to
  install it, how to configure panels for multiple agents, and how to
  authenticate. Use whenever the user mentions Push To Display, pushing agent
  activity to a display board, "pushtodisplay", display boards/dashboards that
  mirror agent or CI status, PUSHTODISPLAY_* environment variables, or panel
  configuration for status boards.
---

# Push To Display (pi-pushtodisplay)

`pi-pushtodisplay` is a pi package (extension + skill) that mirrors agent
activity onto a **Push To Display** board (https://pushtodisplay.com) in real
time. A panel is a **shared scrolling log**: one entry per event, newest at the
top, and every entry has the same shape:

```
<agent> <what happened> <STATUS> <time>
```

```
pi-pushtodisplay session closed ENDED 12:10
pi-pushtodisplay Pinned the clock so the release test passes. DONE 12:09
pi-pushtodisplay Allow bash: git push --force NEEDS 12:08
pi-pushtodisplay running grep FAIL 12:07
pi-pushtodisplay test with some dummy turns. RUN 12:06
```

Three bodies are shortened, each by structure first: a tool description is
capped at 48 characters and over-budget ones are *summarised* (a long command
keeps its program and subcommand, a long path drops its directory before its
file name); the prompt and the result keep their first usable sentence, capped
at 60 characters. `DONE` quotes the agent — it never reports counters, because
"ran 5 tools" tells a reader nothing.

The agent name leads so each agent reads as a column on a shared panel — several
agents may write to one panel, since all of them default to panel 1. There is no
separator glyph: the fields are plain words at the board's default type size, and
the upper-case status marks the end of the event.

The status word is a closed vocabulary — `READY`, `RUN`, `OK`, `FAIL`, `NEEDS`,
`DONE`, `STOP`, `ENDED` — in upper case. Each line is four inline runs on one
fixed dark surface (`#1b2430`): the agent name in teal, the body near-white,
the status in its own hue, the time dimmed. The surface is hard-coded rather
than inherited because the board can be light or dark and the extension cannot
detect the theme; `palette.test.ts` asserts every colour clears 4.5:1 against
it. No icons: a symbol needs a legend, a word does not.

Rendering model worth knowing when editing this package: a board message is
**one wrapping paragraph** whose `blocks` are inline runs (like `<span>`, not
`<p>`). Each message here is one log line — four inline runs, not a stack of
fields.

`READY` and `ENDED` bracket a session and are posted on every start and every
close, reloads included: silence alone cannot distinguish a finished agent from a
killed one, so the panel says when it opens and closes.

Steps are posted when they *finish*, so a line never claims to be "running" after
it is over. `FAIL` means a step failed or the provider did; `STOP` means you
pressed Escape. Nothing infers a verdict about the run from counters.

It is driven entirely by pi session events — users do **not** need to call it
from prompts.

## When to help

Help when the user wants to:

- **Install** the package: `pi install npm:pi-pushtodisplay` (or
  `git:github.com/pushtodisplay/pi-pushtodisplay`, or a local path).
- **Authenticate**: tell them to run `/pushtodisplay-login` (opens the
  browser, OAuth device-code flow via the `pushtodisplay` CLI; credentials are
  stored in the OS keychain — macOS Keychain, Linux libsecret, Windows
  Credential Manager — with a plaintext fallback at
  `~/.config/pushtodisplay/credentials.json` only when no keychain is
  available; tokens auto-refresh). Status: `/pushtodisplay-status`. Wiring
  check: `/pushtodisplay-test`.
- **Configure panels** for parallel agents. Each agent writes to one panel
  (1–4, default 1); sharing a panel is supported because it is a shared log and
  every line starts with the agent name.
- **Write a `log cleared` entry** with `/pushtodisplay-clear`.
- **Reduce volume** with `PUSHTODISPLAY_STEPS=0` — posts only milestones
  (session open/close, tasks, results, alerts), not each tool step.
- **Troubleshoot** a board that never updates.

Note: `/pushtodisplay-*` are extension **commands** (slash commands run on the
user's side, not tool calls). The agent can't run them itself — guide the user,
or set env vars / config files on their behalf.

## Configuration (env vars)

| Env var | Default | Meaning |
| --- | --- | --- |
| `PUSHTODISPLAY_BOARD_ID` | default board | Send to a specific board. |
| `PUSHTODISPLAY_PANEL` | `1` | Which panel (1–4) this agent writes to. |
| `PUSHTODISPLAY_LABEL` | session name, then workspace folder | Agent name in the first field of every line. |
| `PUSHTODISPLAY_STEPS` | on | `0` skips per-tool entries. |
| `PUSHTODISPLAY_DISABLED` | off | `1` disables the extension. |

### Setting up a panel for a specific agent

To have a pi agent (e.g. a `release` subagent) drive panel 2 with a friendly
label, set the env vars where that agent launches:

```bash
PUSHTODISPLAY_PANEL=2 PUSHTODISPLAY_LABEL=release pi
```

Subagent workflows inherit env vars from the parent session; if the user wants
label/panel differences per agent, launch each agent process with its own env.

## Behavior details worth knowing

- **Auth gating:** auth is probed at session start and re-probed lazily on send
  at most once every 20 s while unauthenticated; `/pushtodisplay-status` forces
  a check. Once auth is known to be bad, updates are dropped (never buffered)
  and sending resumes after login.
- **Rate limiting:** every API call counts toward the account's monthly message
  quota and Sandbox tiers cap ~1 msg/s. Entries are queued in strict order,
  spaced ≥ 1.2 s, consecutive duplicates are suppressed, and the backlog is
  trimmed (oldest steps first) so the log cannot fall far behind. One entry per
  tool step therefore costs one message — that is the intended behaviour, and
  `PUSHTODISPLAY_STEPS=0` is the way to reduce it.
- **Not-authenticated warning:** one warning is shown when the probe fails;
  `/pushtodisplay-status` rechecks on demand, and `/pushtodisplay-login`
  restores sending.
- **CLI not found:** the package bundles the `pushtodisplay` CLI as a
  dependency (`pi install` handles it). If it's still missing, suggest
  `npm i -g pushtodisplay`.

## Reference

- Package docs: see the `README.md` in the `pi-pushtodisplay` package.
- Auth flow lives in the CLI: `pushtodisplay auth login --device-code`.
- Push To Display is a product of Goban Source, LLC —
  [pushtodisplay.com](https://pushtodisplay.com).
