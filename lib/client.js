// dsh-plugin-desktop-notify — browser half.
//
// Watches the client-side approval / question waterfalls and the per-session
// running status, and raises an OS notification ONLY while the client window is
// neither focused nor visible. Every notification carries the concrete summary
// of what the user has to do, because a bare "something happened" toast is
// useless once you are heads-down in another window.
//
// A renderer cannot be inspected from outside, so every decision this half makes
// (event arrived / which gate suppressed it / did `new Notification()` throw) is
// POSTed to the host half's `/api/desktop-notify/report`, which appends it to
// `_probe/notify-trace.jsonl`. Set `_probe/notify-selftest.flag` to make the next
// page load raise one focus-independent test notification.
//
// Loaded through the lazy-CJS module table: a package declaring
// `dsh.client.platform = web` and exporting `./client` gets this file evaluated
// in the page, where it registers itself on `window.__ModuleLoader__`.
window.__ModuleLoader__.load({
  id: 'dsh-plugin-desktop-notify',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports

    /** Client services this half reads. All three ship with the web app. */
    const inject = ['remote', 'locale', 'sessions']

    /** Notification headlines, one per situation. */
    const TITLE = {
      command: '有任务需要授权',
      file: '有文件需要修改',
      other: '有任务需要你确认',
      question: '有问题需要你回答',
      done: '任务已完成',
    }

    // Tool families whose approval means "let this run with more permission".
    const COMMAND_TOOL = /pwsh|powershell|bash|shell|terminal|cmd|exec|process|script/i
    // Tool families whose approval means "write to a file".
    const FILE_TOOL = /write|edit|patch|replace|rename|delete|move|create|fs_/i

    const DEDUPE_MS = 1500
    const recent = new Map()
    const running = new Map()

    /** POST one diagnostic line to the host half. Never affects the UI. */
    function report(payload) {
      try {
        if (typeof fetch !== 'function') return
        const pending = fetch('/api/desktop-notify/report', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
          keepalive: true,
        })
        if (pending && typeof pending.catch === 'function') pending.catch(() => {})
      } catch (err) { /* diagnostics stay silent */ }
    }

    function permissionValue() {
      try { return typeof Notification === 'undefined' ? null : Notification.permission } catch (err) { return 'unreadable' }
    }

    /** The environment facts that decide whether a notification can ever work. */
    function environment() {
      let hasNotification = false
      try { hasNotification = typeof Notification !== 'undefined' } catch (err) { /* absent */ }
      return {
        href: typeof location !== 'undefined' ? String(location.href) : '',
        origin: typeof location !== 'undefined' ? String(location.origin) : '',
        secureContext: typeof isSecureContext === 'boolean' ? isSecureContext : null,
        hasNotification: hasNotification,
        permission: permissionValue(),
        hidden: typeof document !== 'undefined' && document.hidden === true,
        hasFocus: typeof document !== 'undefined' && typeof document.hasFocus === 'function' ? document.hasFocus() : null,
        moduleLoader: typeof window !== 'undefined' ? typeof window.__ModuleLoader__ : 'no-window',
      }
    }

    /** Whether the same logical event was already notified moments ago. */
    function firstTime(key) {
      const now = Date.now()
      const last = recent.get(key)
      if (last !== undefined && now - last < DEDUPE_MS) return false
      recent.set(key, now)
      if (recent.size > 64) {
        for (const entry of recent) if (now - entry[1] > 60000) recent.delete(entry[0])
      }
      return true
    }

    /** True while the window is minimized, hidden, or simply not the focused app. */
    function isAway() {
      try {
        if (typeof document === 'undefined') return false
        if (document.hidden === true) return true
        return document.hasFocus() === false
      } catch (err) {
        return false
      }
    }

    /** The desktop shell auto-grants this permission, so it is normally 'granted'. */
    function canNotify() {
      try {
        if (typeof Notification === 'undefined') return false
        return Notification.permission === 'granted' || Notification.permission === 'default'
      } catch (err) {
        return false
      }
    }

    /**
     * Show one notification, else record exactly which gate stopped it.
     * The dedupe key is consumed only when a toast really appears, so an event
     * suppressed for focus never eats the window of a later, genuine one.
     * `force` is used only by the self-test, which must ignore the focus gate.
     */
    function raiseOnce(key, title, body, tag, force) {
      if (!canNotify()) {
        report({ kind: 'suppressed', reason: 'no-permission-api', title: title, permission: permissionValue() })
        return false
      }
      if (force !== true && !isAway()) {
        report({ kind: 'suppressed', reason: 'window-in-front', title: title, key: key })
        return false
      }
      if (force !== true && !firstTime(key)) {
        report({ kind: 'suppressed', reason: 'duplicate', title: title, key: key })
        return false
      }
      try {
        const notification = new Notification(title, {
          body: body || '',
          tag: tag || 'dsh-desktop-notify',
        })
        notification.onclick = () => {
          try { window.focus() } catch (err) { /* focus is best effort */ }
          try { notification.close() } catch (err) { /* already dismissed */ }
        }
        report({ kind: 'shown', title: title, body: body, tag: tag, forced: force === true, permission: permissionValue() })
        return true
      } catch (err) {
        report({ kind: 'threw', title: title, message: String((err && err.message) || err) })
        return false
      }
    }

    /** Flatten a localized-text value ({ en, zh } or a plain string) to one line. */
    function textOf(value) {
      if (value === null || value === undefined) return ''
      if (typeof value === 'string') return value
      if (typeof value === 'object') {
        if (typeof value.zh === 'string' && value.zh.trim()) return value.zh
        if (typeof value.en === 'string' && value.en.trim()) return value.en
      }
      return ''
    }

    /** The audit reason with its machine prefix ('escalate sandbox to <mode>:') removed. */
    function auditText(request) {
      const raw = request && request.reason
      if (typeof raw !== 'string') return ''
      return raw.replace(/^escalate sandbox to [^:]+:\s*/i, '').trim()
    }

    /** The localized presentation text the approval panel itself would show. */
    function displayText(ctx, request) {
      const raw = request && request.displayReason
      if (raw === undefined) return ''
      try {
        if (ctx.locale && typeof ctx.locale.resolveText === 'function') {
          const resolved = textOf(ctx.locale.resolveText(raw))
          if (resolved.trim()) return resolved.trim()
        }
      } catch (err) { /* fall through to the raw shapes */ }
      return textOf(raw).trim()
    }

    /** 'command' | 'file' | 'other' — what a pending approval actually asks for. */
    function classify(toolName) {
      const name = typeof toolName === 'string' ? toolName : ''
      if (COMMAND_TOOL.test(name)) return 'command'
      if (FILE_TOOL.test(name)) return 'file'
      return 'other'
    }

    /** One-line lead describing the action the user must take. */
    function leadOf(kind) {
      if (kind === 'file') return '需要授权修改文件'
      if (kind === 'command') return '需要授权执行命令'
      return '需要你确认这次操作'
    }

    function clip(text, max) {
      const value = String(text === null || text === undefined ? '' : text).replace(/\s+/g, ' ').trim()
      return value.length > max ? value.slice(0, max - 1) + '…' : value
    }

    /** Build the notification body: lead line, then the concrete summary. */
    function approvalBody(ctx, request) {
      const tool = request && typeof request.toolName === 'string' && request.toolName ? request.toolName : '未知工具'
      const kind = classify(request && request.toolName)
      const summary = auditText(request) || displayText(ctx, request)
      const lines = [leadOf(kind) + '（工具 ' + tool + '）']
      if (summary) lines.push(clip(summary, 180))
      return lines.join('\n')
    }

    function onApproval(ctx, request) {
      const tool = request && request.toolName
      const callId = request && request.callId
      report({ kind: 'event', name: 'approval/request', tool: String(tool), callId: String(callId), reason: String((request && request.reason) || '') })
      const kind = classify(tool)
      raiseOnce('approval:' + String(tool) + ':' + String(callId), TITLE[kind] || TITLE.other, approvalBody(ctx, request), 'dsh-approval')
    }

    /** Best-effort extraction of the question the model is waiting on. */
    function questionText(request) {
      try {
        const list = request && (request.questions || request.items)
        if (Array.isArray(list) && list.length > 0) {
          const first = list[0]
          const asked = first && (first.question || first.text || first.title)
          if (typeof asked === 'string' && asked.trim()) return asked.trim()
        }
        const direct = request && (request.question || request.text || request.prompt)
        if (typeof direct === 'string' && direct.trim()) return direct.trim()
      } catch (err) { /* shape drift is not worth a broken question UI */ }
      return ''
    }

    function onQuestion(request) {
      const asked = questionText(request)
      report({ kind: 'event', name: 'user-questions/request', question: clip(asked, 120) })
      raiseOnce('question:' + clip(asked, 80), TITLE.question, asked ? clip(asked, 180) : '模型在等你回答', 'dsh-question')
    }

    /** Session label plus whether this is a subagent session (those stay silent). */
    function sessionInfo(ctx, sessionId) {
      try {
        const list = ctx.sessions && ctx.sessions.list
        const snapshot = list && typeof list.getSnapshot === 'function' ? list.getSnapshot() : undefined
        const row = snapshot && snapshot.byId ? snapshot.byId[sessionId] : undefined
        if (!row) return { title: '', subagent: false }
        return {
          title: typeof row.title === 'string' ? row.title.trim() : '',
          subagent: typeof row.parentSessionId === 'string' && row.parentSessionId.length > 0,
        }
      } catch (err) {
        return { title: '', subagent: false }
      }
    }

    function onStatus(ctx, sessionId, isRunning) {
      const previous = running.get(sessionId)
      running.set(sessionId, isRunning === true)
      if (isRunning === true) return
      // Only a true -> false edge is a finished turn; a first sighting is not.
      if (previous !== true) {
        report({ kind: 'status-cold', sessionId: String(sessionId), running: isRunning })
        return
      }
      const info = sessionInfo(ctx, sessionId)
      if (info.subagent) {
        report({ kind: 'status-subagent', sessionId: String(sessionId) })
        return
      }
      const lines = []
      if (info.title) lines.push(clip(info.title, 80))
      lines.push('回合已结束，回到客户端看看结果')
      raiseOnce('done:' + String(sessionId), TITLE.done, lines.join('\n'), 'dsh-done')
    }

    /** Raise one focus-independent test toast when the host half says so. */
    function selfTest() {
      try {
        if (typeof fetch !== 'function') return
        const pending = fetch('/api/desktop-notify/selftest', { headers: { accept: 'application/json' } })
        if (!pending || typeof pending.then !== 'function') return
        pending
          .then((res) => (res && typeof res.json === 'function' ? res.json() : null))
          .then((data) => {
            report({ kind: 'selftest-probe', data: data })
            if (data && data.test === true) {
              setTimeout(() => {
                raiseOnce('selftest:' + Date.now(), '通知自检', '看到这条 = 通知通道正常；这条是强制弹出，忽略前后台判断', 'dsh-selftest', true)
              }, 2000)
            }
          })
          .catch(() => {})
      } catch (err) { /* a failed self-test must not break the page */ }
    }

    /**
     * Mount the three watchers. None of them may ever break the UI it observes.
     *
     * The whole body is wrapped so that a renamed or missing client service is
     * recorded on the diagnostic channel before the error is rethrown (keeping it
     * visible in the console). Without this, the most likely way for a DSH upgrade
     * to break the plugin — an event or service rename — would look exactly like
     * "the plugin is installed and simply never fires".
     */
    function apply(ctx) {
      try {
        mount(ctx)
      } catch (err) {
        report({ kind: 'apply-failed', message: String((err && err.message) || err) })
        throw err
      }
    }

    /** The actual wiring; see apply() for why it is wrapped. */
    function mount(ctx) {
      report({ kind: 'client-apply', env: environment() })
      ctx.remote.$on('approval/request', function (request, next) {
        try { onApproval(ctx, request) } catch (err) { /* never block an approval */ }
        return typeof next === 'function' ? next() : undefined
      })
      ctx.remote.$on('user-questions/request', function (request, next) {
        try { onQuestion(request) } catch (err) { /* never block a question */ }
        return typeof next === 'function' ? next() : undefined
      })
      ctx.remote.$on('api-session/status', function (sessionId, isRunning) {
        try { onStatus(ctx, sessionId, isRunning) } catch (err) { /* never block status */ }
      })
      selfTest()
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})