# dsh-plugin-desktop-notify

Context-aware desktop notifications for DeepSeek Harness — filling the gap left by
the official client, which has no notification feature at all.

Verified on: DSH Desktop `0.2.0-rc.2` (Electron 44) · Windows 11 · `desktop` profile.
The page origin is `dsh-app://app/` (a secure context), the notification permission is
granted automatically by the desktop shell, and `new Notification()` produces a real
Windows Action Center toast titled **DeepSeek Harness**. Sound is the Windows default
(`silent` stays `false`; no custom audio).

## What it solves

When the client is minimised or covered by another window (you are reading a browser,
running ComfyUI, …), you cannot see the approval card asking for your permission, and
you cannot tell when a turn finished. This plugin raises a **system notification** at
those moments, carrying the **concrete summary** of what you have to do.

| Situation | Notification title | Body |
|---|---|---|
| Command needs approval (`pwsh` / `bash`, …) | `有任务需要授权` | tool name + what the operation is for (the approval justification, with the `escalate sandbox to <mode>:` machine prefix stripped) |
| File write needs approval (`write` / `edit`, …) | `有文件需要修改` | tool name + what the operation is for |
| Any other tool needs confirmation | `有任务需要你确认` | tool name + approval reason |
| The model is waiting for an answer | `有问题需要你回答` | the question text |
| A turn finished | `任务已完成` | session name + a nudge back to the client |

> The notification titles are Chinese by design — the plugin was built for a
> Chinese-language workflow. See below if you want to change them.

## When it stays quiet

- The client is in front (window focused, page visible): never raises anything, the UI
  shows the same information as usual;
- A subagent session finishes: silent — only top-level sessions notify;
- A session that was already idle when the page loaded: silent — only a real
  `running: true -> false` edge notifies;
- The same event delivered twice within 1.5 s: one toast.

Usage note: **send your message first, then switch away immediately.** The turn starts
when you hit send, so the events only happen while you are away. Doing it the other way
round (switch away first, then come back to type) puts the window back in front, and by
design nothing pops.

## Install

```sh
dsh plugin --profile desktop add link:<this directory>
# or from the repository:
dsh plugin --profile desktop add github:LeeRolling/dsh-plugin-desktop-notify
```

The package declares `dsh.bundle.patch` + `dsh.client`; **restart the client** to
activate. With a `link:` install, editing `lib/client.js` only needs a restart, not a
reinstall.

## Uninstall

```sh
dsh plugin --profile desktop remove dsh-plugin-desktop-notify
```

## Layout

```
package.json            dsh.bundle.patch + dsh.client.platform=web
cordis.patch.yml        inserts one host row into the profile
lib/paths.js            where the diagnostic files live (overridable, no machine paths)
lib/index.js            host half: the permanent diagnostic channel
lib/client.js           browser half: three watchers + classification + notifications
test/client.test.mjs    fake-DOM smoke test (npm test, no DSH required)
tools/trace.mjs         print a trace summary
```

The browser half subscribes to three client events:

| Event | Purpose |
|---|---|
| `approval/request` | approval waterfall — observe only, never consume (`return next()`) |
| `user-questions/request` | model question waterfall, same |
| `api-session/status` | session running state; the `true -> false` edge is a finished turn |

## Diagnostic channel (**kept permanently**)

What happens in a renderer is invisible from the outside, so the two halves share two
dedicated endpoints, **always on**. Whenever a notification misbehaves, look here first —
no code changes, no extra logging:

| Endpoint | Direction | Purpose |
|---|---|---|
| `POST /api/desktop-notify/report` | browser → host | one line per decision: did the event arrive, which gate suppressed it, did `new Notification()` throw, plus an environment snapshot |
| `GET /api/desktop-notify/selftest` | browser → host | reports the self-test switch state and the resolved trace/flag paths |

### Where the files are

By default the trace is written to `<DSH_HOME|~/.dsh>/desktop-notify/trace.jsonl`.
Set `DSH_DESKTOP_NOTIFY_TRACE` to relocate it (the `selftest.flag` always sits next to
the trace). The directory is created on demand — **there is no hardcoded machine path
anywhere in the code**. Setting `DSH_DESKTOP_NOTIFY_TRACE` to `off` (or `0` / `false` /
`none` / `no`) turns writing off entirely while the endpoints and self-test keep working.

The trace **self-rotates**: past 512 KB it drops the older half and keeps the most recent
256 KB, always cutting on a line boundary so the JSONL stays parsable.

### How to read it

| kind | Meaning |
|---|---|
| `host-apply` | host half mounted (pid / Electron / Node version / trace path) |
| `client-apply` | browser half mounted, with an environment snapshot |
| `event` | the event really reached the browser half |
| `suppressed` | a gate stopped it: `window-in-front` / `duplicate` / `no-permission-api` |
| `shown` | a toast really appeared (`forced:true` = the self-test) |
| `threw` | `new Notification()` threw; `message` carries the reason |
| `apply-failed` | the browser half threw while **mounting** (typically a DSH upgrade renaming a service or event) — this is what stops "installed but never fires" from looking like "not installed" |

```sh
node tools/trace.mjs          # counts + the last 15 entries
node tools/trace.mjs --all    # everything
```

### Self-test

Drop a `selftest.flag` next to the trace (i.e.
`<DSH_HOME|~/.dsh>/desktop-notify/selftest.flag`); 2 s after the next page load a toast
titled `通知自检` is raised **regardless of focus** — that separates "the code never ran"
from "the system refused to show it". Delete the file afterwards, or it will pop on every
page load.

## Tests

```sh
npm test
```

Fake DOM + fake Notification + fake fetch; the browser half is executed as an ordinary
module. 15 assertions cover the three events, classification, the front gate, dedupe,
subagent silence, the cold-idle edge, click-to-focus and the forced self-test.
**No DSH instance required.**

## Verification log

| Date | Scenario | Result |
|---|---|---|
| 2026-10-01 | Channel self-test (forced, focus ignored) | ✅ screenshot, trace `shown forced:true` |
| 2026-10-01 | Turn end + session summary (real path) | ✅ screenshot, trace `shown forced:false` |
| 2026-10-01 | Front gate (real scenario) | ✅ trace `suppressed window-in-front` |
| 2026-10-11 | Trace lands on the new path after restart | ✅ `host-apply` records `~/.dsh/desktop-notify/trace.jsonl`, `traceEnabled:true` |
| 2026-10-11 | **Question** notification (really triggered) | ✅ the `event` line captured the full question text; the client was in front, so `suppressed window-in-front` (quiet by design) |
| 2026-10-11 | **Waiting for approval (command)** (real approval event) | ✅ screenshot + trace `shown forced:false`: title `有任务需要授权`, body `需要授权执行命令（工具 pwsh）` + the purpose summary (`escalate sandbox to <mode>:` prefix correctly stripped) |
| 2026-10-11 | The GitHub-installed release in real use | ✅ several `shown` (turn end) produced by the release copy — end-to-end loop closed |
| pending | Waiting for approval (**file** `write` / `edit`) | ⏳ same `raiseOnce` + classification path, not yet triggered by a real event |

## Known limitations

- "Click the toast to come back" relies on `window.focus()`, which is best effort;
  Electron does not guarantee raising the window. The preload-exposed `dshDesktop` has no
  focus/flash call, so a hard guarantee would mean patching the `app.asar` main process —
  wiped by client updates, so it is deliberately not done.
- Notifications only arrive while the client process is alive; a fully exited client
  cannot be reached.
- The three event names are an internal DSH contract, not a published API. DSH is still
  an rc, so a rename would make the plugin go silently quiet — which is exactly what the
  trace is for.

## Acknowledgments and sources

See the 「致谢与来源」 section of [README.md](README.md) — attribution is a hard requirement
for this repository.