/**
 * Where the desktop-notify diagnostic files live, and whether they are written.
 *
 * Resolution order for the trace file:
 *   1. `DSH_DESKTOP_NOTIFY_TRACE` — an explicit path, used verbatim;
 *      the values `off` / `0` / `false` / `none` / `no` instead DISABLE writing;
 *   2. `<DSH_HOME|~/.dsh>/desktop-notify/trace.jsonl` — the default.
 *
 * Nothing here may be absolute to one machine: the plugin is published, and a
 * hardcoded workspace path both leaks the author's layout and silently breaks
 * every other install (the trace directory would not exist).
 */
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

/** Values of DSH_DESKTOP_NOTIFY_TRACE that turn the trace off instead of naming a file. */
const DISABLED = /^(off|0|false|none|no)$/i

/** Whether the trace is written at all. On unless explicitly switched off. */
export function traceEnabled() {
  const value = process.env.DSH_DESKTOP_NOTIFY_TRACE
  return !(typeof value === 'string' && DISABLED.test(value.trim()))
}

/** The JSONL trace written by the host half (a path even when writing is off). */
export function resolveTraceFile() {
  const explicit = process.env.DSH_DESKTOP_NOTIFY_TRACE
  if (typeof explicit === 'string') {
    const trimmed = explicit.trim()
    if (trimmed && !DISABLED.test(trimmed)) return trimmed
  }
  return join(dshHome(), 'desktop-notify', 'trace.jsonl')
}

/** The self-test switch, which always sits next to the trace. */
export function resolveSelftestFlag() {
  return join(dirname(resolveTraceFile()), 'selftest.flag')
}

/** The DSH home directory, honouring DSH_HOME the same way the harness does. */
function dshHome() {
  const configured = process.env.DSH_HOME
  if (typeof configured === 'string' && configured.trim()) return configured.trim()
  return join(homedir(), '.dsh')
}
