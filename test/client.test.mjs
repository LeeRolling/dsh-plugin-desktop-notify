// Browser-half behaviour, checked without a browser.
//
//   npm test   (or: node test/client.test.mjs)
//
// The bundle is evaluated against a hand-rolled DOM/Notification/fetch stub, then
// driven through the three watchers the plugin subscribes to. It exits non-zero
// on the first failed expectation, so it is usable as a CI gate.
import { readFileSync } from 'node:fs'

const SRC = new URL('../lib/client.js', import.meta.url)

const shown = []
const reports = []
let focused = false
let hidden = false
let failures = 0

globalThis.document = { get hidden() { return hidden }, hasFocus() { return focused } }
globalThis.location = { href: 'dsh-app://app/', origin: 'dsh-app://app' }
globalThis.isSecureContext = true
globalThis.Notification = class {
  static permission = 'granted'
  constructor(title, options) { this.title = title; this.options = options || {}; shown.push(this) }
  close() { this.closed = true }
}
globalThis.window = { focus() { focused = true } }
globalThis.fetch = async (url, init) => {
  reports.push({ url: String(url), body: init && init.body ? JSON.parse(init.body) : null })
  if (String(url).includes('selftest')) return { json: async () => ({ test: true, trace: 'stub' }) }
  return { json: async () => ({}) }
}

let loaded = null
globalThis.window.__ModuleLoader__ = { load(spec) { loaded = spec } }
new Function(readFileSync(SRC, 'utf8'))()
if (!loaded) throw new Error('bundle never registered itself via __ModuleLoader__.load')
if (loaded.id !== 'dsh-plugin-desktop-notify') throw new Error('bundle registered under the wrong id: ' + loaded.id)

const exports = loaded.factory(() => { throw new Error('unexpected require') })
const handlers = new Map()
const ctx = {
  remote: { $on(name, fn) { handlers.set(name, fn); return () => handlers.delete(name) } },
  locale: { resolveText: (value) => value },
  sessions: {
    list: {
      getSnapshot: () => ({ byId: {
        'sess-1': { id: 'sess-1', title: '给市场页加缩略图' },
        'sub-1': { id: 'sub-1', title: '子代理', parentSessionId: 'sess-1' },
      } }),
    },
  },
}
exports.apply(ctx)

const approve = handlers.get('approval/request')
const status = handlers.get('api-session/status')
const question = handlers.get('user-questions/request')
const next = () => 'next'
const last = () => shown[shown.length - 1]

function ok(label, pass, detail) {
  if (!pass) failures += 1
  console.log((pass ? 'PASS ' : 'FAIL ') + label + (detail ? '  -> ' + detail : ''))
}

ok('subscribes to all three events', handlers.size === 3, [...handlers.keys()].join(','))
ok('reports the environment on apply', reports.some((r) => r.body && r.body.kind === 'client-apply'))

const command = { toolName: 'pwsh', callId: 'c1', reason: 'escalate sandbox to danger-full-access: 需要在 C:\\Users\\Admin\\.dsh 下重打补丁' }
const file = { toolName: 'edit', callId: 'c2', reason: 'escalate sandbox to workspace-write: 需要改写 lib/client.js 的通知逻辑' }
const other = { toolName: 'present', callId: 'c3', reason: 'tool "present" requires approval' }

focused = true
approve(command, next)
ok('stays silent while the window is in front', shown.length === 0, 'notifications=' + shown.length)
ok('records the front-gate suppression', reports.some((r) => r.body && r.body.kind === 'suppressed' && r.body.reason === 'window-in-front'))

focused = false
approve(command, next)
ok('notifies once the window is away', shown.length === 1 && last().title === '有任务需要授权', JSON.stringify(last() && last().options.body))
approve(command, next)
ok('dedupes a repeat within 1.5s', shown.length === 1, 'notifications=' + shown.length)
approve(file, next)
ok('classifies a file approval as 有文件需要修改', last().title === '有文件需要修改', JSON.stringify(last().options.body))
approve(other, next)
ok('falls back to 有任务需要你确认', last().title === '有任务需要你确认', JSON.stringify(last().options.body))
ok('reports every shown toast', reports.some((r) => r.body && r.body.kind === 'shown'))

hidden = true
question({ questions: [{ question: '缩略图用方案一还是方案二？' }] }, next)
ok('classifies a question as 有问题需要你回答', last().title === '有问题需要你回答', JSON.stringify(last().options.body))

hidden = false
status('sess-1', true)
status('sess-1', false)
ok('notifies on the turn-end edge and names the session', last().title === '任务已完成' && last().options.body.includes('给市场页加缩略图'), JSON.stringify(last().options.body))

const mark = shown.length
status('sub-1', true)
status('sub-1', false)
status('never-seen', false)
ok('stays silent for subagent and cold-idle sessions', shown.length === mark, 'added=' + (shown.length - mark))

shown[0].onclick()
ok('clicking a toast focuses the window', focused === true)

const beforeSelfTest = shown.length
await new Promise((resolve) => setTimeout(resolve, 2400))
const forced = shown.slice(beforeSelfTest)
ok('self-test fires regardless of focus', forced.length === 1 && forced[0].title === '通知自检', JSON.stringify(forced.map((f) => f.title)))
ok('self-test reports its probe and its toast', reports.some((r) => r.body && r.body.kind === 'selftest-probe') && reports.some((r) => r.body && r.body.kind === 'shown' && r.body.forced === true))

console.log('---')
console.log(shown.length + ' toasts, ' + reports.length + ' reports, ' + failures + ' failure(s)')
if (failures > 0) process.exitCode = 1
