/**
 * dsh-plugin-desktop-notify — host half.
 *
 * Only the renderer can raise an OS notification, so the browser half does the
 * work. This half exists for two reasons:
 *
 * 1. client-modules discovers `dsh.client` packages by scanning the host
 *    Loader's entries, so this package must be a loaded host row for the
 *    browser half to reach the page at all.
 * 2. It owns the permanent diagnostic channel. A renderer cannot be inspected
 *    from outside, so the browser half POSTs what it observed (event arrived /
 *    which gate suppressed it / did `new Notification()` throw) to
 *    `/api/desktop-notify/report`, and this half appends it to a JSONL trace.
 *    That trace is the first place to look whenever a notification fails to
 *    appear — it separates "the code never ran" from "the system refused to
 *    show it".
 *
 * The trace is kept permanently and self-rotates, so it never grows unbounded;
 * its directory is created on demand. See lib/paths.js for where it lives.
 * Drop a file at the self-test flag path to make the browser half raise one
 * focus-independent test notification on the next page load.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { resolveSelftestFlag, resolveTraceFile, traceEnabled } from './paths.js'

const TRACE_FILE = resolveTraceFile()
const SELFTEST_FLAG = resolveSelftestFlag()
const TRACE_ENABLED = traceEnabled()

/** Rotate once the trace passes the high-water mark, keeping the most recent tail. */
const TRACE_MAX_BYTES = 512 * 1024
const TRACE_KEEP_BYTES = 256 * 1024

export default {
  name: 'dsh-plugin-desktop-notify',
  inject: ['webServer'],
  apply(ctx) {
    /** Trim the trace, cutting on a line boundary so the JSONL stays parsable. */
    function rotate() {
      const text = readFileSync(TRACE_FILE, 'utf8')
      const cut = text.length - TRACE_KEEP_BYTES
      if (cut <= 0) return
      const newline = text.indexOf('\n', cut)
      writeFileSync(TRACE_FILE, newline === -1 ? '' : text.slice(newline + 1))
    }

    /** Append one diagnostic line. Never let diagnostics break the plugin. */
    function trace(entry) {
      if (!TRACE_ENABLED) return
      try {
        const directory = dirname(TRACE_FILE)
        if (!existsSync(directory)) mkdirSync(directory, { recursive: true })
        const line = JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n'
        if (existsSync(TRACE_FILE) && statSync(TRACE_FILE).size > TRACE_MAX_BYTES) rotate()
        appendFileSync(TRACE_FILE, line)
      } catch { /* diagnostics must never break notifications */ }
    }
    trace({
      kind: 'host-apply',
      pid: process.pid,
      electron: process.versions.electron ?? null,
      node: process.versions.node,
      traceFile: TRACE_FILE,
      traceEnabled: TRACE_ENABLED,
    })

    const readJsonBody = async (req) => {
      let raw = ''
      for await (const chunk of req) raw += chunk
      if (!raw) return {}
      try { return JSON.parse(raw) } catch { return {} }
    }
    const json = (res, status, data) => {
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      res.end(JSON.stringify(data))
    }

    /** POST /api/desktop-notify/report — one browser-half observation. */
    async function reportHandler(req, res) {
      const body = await readJsonBody(req)
      trace({ kind: 'client-report', report: body })
      res.writeHead(204, { 'cache-control': 'no-store' })
      res.end()
    }

    /** GET /api/desktop-notify/selftest — should the browser half self-test on boot? */
    function selftestHandler(_req, res) {
      json(res, 200, {
        test: existsSync(SELFTEST_FLAG),
        trace: TRACE_FILE,
        flag: SELFTEST_FLAG,
        traceEnabled: TRACE_ENABLED,
      })
    }

    ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/api/desktop-notify/report', handler: reportHandler }))
    ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/api/desktop-notify/selftest', handler: selftestHandler }))
  },
}