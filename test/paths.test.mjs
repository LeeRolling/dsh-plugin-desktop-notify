// Path resolution and the trace kill switch. No DSH, no filesystem writes.
import { resolveTraceFile, resolveSelftestFlag, traceEnabled } from '../lib/paths.js'

let failures = 0
function ok(label, pass, detail) {
  if (!pass) failures += 1
  console.log((pass ? 'PASS ' : 'FAIL ') + label + (detail ? '  -> ' + detail : ''))
}
const withEnv = (value, fn) => {
  const saved = process.env.DSH_DESKTOP_NOTIFY_TRACE
  if (value === undefined) delete process.env.DSH_DESKTOP_NOTIFY_TRACE
  else process.env.DSH_DESKTOP_NOTIFY_TRACE = value
  try { return fn() } finally {
    if (saved === undefined) delete process.env.DSH_DESKTOP_NOTIFY_TRACE
    else process.env.DSH_DESKTOP_NOTIFY_TRACE = saved
  }
}

const fallback = withEnv(undefined, () => resolveTraceFile())
ok('defaults under <home>/desktop-notify/', /desktop-notify[\\/]trace\.jsonl$/.test(fallback), fallback)
ok('never leaks an absolute author path', !/deepseek-harness[\\/]default-workspace/.test(fallback), fallback)
ok('the self-test flag sits next to the trace', withEnv(undefined, () => resolveSelftestFlag()).endsWith('selftest.flag'))
ok('trace is on by default', withEnv(undefined, () => traceEnabled()) === true)

const custom = withEnv('D:\\logs\\notify.jsonl', () => resolveTraceFile())
ok('an explicit path wins', custom === 'D:\\logs\\notify.jsonl', custom)
ok('the flag follows the explicit path', withEnv('D:\\logs\\notify.jsonl', () => resolveSelftestFlag()) === 'D:\\logs\\selftest.flag')

for (const off of ['off', '0', 'false', 'none', 'no', 'OFF', ' off ']) {
  ok('"' + off + '" disables writing', withEnv(off, () => traceEnabled()) === false)
}
ok('a disable token still yields a usable path', withEnv('off', () => resolveTraceFile()) === fallback)
ok('a real path is not mistaken for a disable token', withEnv('off', () => resolveSelftestFlag()).endsWith('selftest.flag'))

console.log('---')
console.log(failures + ' failure(s)')
if (failures > 0) process.exitCode = 1