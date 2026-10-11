// Read the desktop-notify trace and print a human summary.
//
//   node tools/trace.mjs            # counts + last 15 entries
//   node tools/trace.mjs 40         # keep 40 entries
//   node tools/trace.mjs --all      # every entry
//
// Set DSH_DESKTOP_NOTIFY_TRACE to read a non-default file. `shown` means a toast
// really appeared; `suppressed` records which gate stopped one.
import { readFileSync } from 'node:fs'
import { resolveTraceFile } from '../lib/paths.js'

const FILE = resolveTraceFile()
const arg = process.argv[2]
const keep = arg === '--all' ? Infinity : Number(arg || 15)

let text
try { text = readFileSync(FILE, 'utf8') } catch { console.log('no trace yet at ' + FILE); process.exit(0) }

const entries = text.split('\n').filter(Boolean).map((line) => {
  try { return JSON.parse(line) } catch { return { kind: 'unparsable', line } }
})

const tally = new Map()
const reasons = new Map()
let shown = 0
for (const entry of entries) {
  const report = entry.kind === 'client-report' ? entry.report || {} : {}
  const kind = entry.kind === 'client-report' ? report.kind || 'client-report' : entry.kind
  tally.set(kind, (tally.get(kind) || 0) + 1)
  if (kind === 'shown') shown += 1
  if (kind === 'suppressed') {
    const reason = report.reason || 'unknown'
    reasons.set(reason, (reasons.get(reason) || 0) + 1)
  }
}

console.log('file: ' + FILE)
console.log('entries: ' + entries.length + '  |  shown: ' + shown + '  |  suppressed: ' + (tally.get('suppressed') || 0))
console.log('by kind: ' + [...tally].map(([k, n]) => k + '=' + n).join(', '))
if (reasons.size > 0) console.log('suppressed by: ' + [...reasons].map(([k, n]) => k + '=' + n).join(', '))
console.log('--- last ' + (keep === Infinity ? entries.length : Math.min(keep, entries.length)) + ' ---')
for (const entry of entries.slice(-keep)) {
  const report = entry.kind === 'client-report' ? entry.report || {} : {}
  const label = entry.kind === 'client-report' ? report.kind || 'client-report' : entry.kind
  const detail = report.title || report.name || report.sessionId || (report.env ? 'origin=' + report.env.origin + ' permission=' + report.env.permission : '') || ''
  console.log(entry.at + '  ' + String(label).padEnd(16) + ' ' + detail)
}
