# dsh-plugin-desktop-notify

上下文感知的桌面通知插件，给 DSH 补上官方客户端缺失的通知能力。

已验证环境：DSH Desktop `0.2.0-rc.2`（Electron 44）· Windows 11 · `desktop` profile。
页面 origin 是 `dsh-app://app/`（安全上下文），通知权限由桌面壳自动授予，
`new Notification()` 直接出 Windows 通知中心 Toast，显示名 **DeepSeek Harness**，
声音用 Windows 自带提示音（`silent` 保持默认 false，不加自定义音效）。

## 它解决什么

客户端最小化、或被别的窗口盖住时（比如你正在看浏览器 / ComfyUI），你既看不到
「需要你授权」的审批卡片，也不知道回合什么时候跑完了。本插件在这两类时刻弹一条
**系统通知**，并且正文里带上**任务摘要**，让你一眼知道要做什么。

| 情况 | 通知标题 | 正文 |
|---|---|---|
| 需要授权执行命令（`pwsh` / `bash` 等） | `有任务需要授权` | 工具名 + 该操作用途（审批理由，已剥掉 `escalate sandbox to <mode>:` 机器前缀） |
| 需要授权改文件（`write` / `edit` 等） | `有文件需要修改` | 工具名 + 该操作用途 |
| 其它工具需要确认 | `有任务需要你确认` | 工具名 + 审批理由 |
| 模型提问等你回答 | `有问题需要你回答` | 问题原文 |
| 回合结束 | `任务已完成` | 会话名 + 提示回客户端看结果 |

## 什么时候**不**打扰你

- 客户端在前台（窗口获得焦点、页面可见）时：一律不弹，只在 UI 里照常显示；
- 子代理（subagent）会话的回合结束：不弹，只有主会话完成才提醒；
- 冷启动时本就处于 idle 的会话：不弹，只有观测到 `running: true -> false` 这个真实边沿才提醒；
- 同一事件 1.5 秒内重复投递：只弹一次。

用法提醒：**先在客户端发消息，再立刻切走**。回合是从你按下发送开始的，
切走之后事件才会发生在你不在场的时候；反过来（先切走再回来打字）会把你带回前台，
按设计就不弹了。

## 安装

```sh
dsh plugin --profile desktop add link:<本目录>
# 或从仓库装：
dsh plugin --profile desktop add github:LeeRolling/dsh-plugin-desktop-notify
```

本目录已声明 `dsh.bundle.patch` + `dsh.client`，装完**重启客户端**生效。
因为装的是 `link:`，改 `lib/client.js` 后重启即可，无需重装。

## 卸载

```sh
dsh plugin --profile desktop remove dsh-plugin-desktop-notify
```

## 结构

```
package.json            dsh.bundle.patch + dsh.client.platform=web
cordis.patch.yml        向 profile 插入一行 host 加载项
lib/paths.js            诊断文件位置（可覆盖，无机器相关绝对路径）
lib/index.js            宿主半：常驻诊断通道（报告接收 + 自检开关 + trace 轮转）
lib/client.js           浏览器半：三个 watcher + 分类 + 通知
test/client.test.mjs    假 DOM 冒烟测试（npm test，不需启动 DSH）
tools/trace.mjs         读 trace 打印摘要
```

浏览器半订阅三个客户端事件：

| 事件 | 用途 |
|---|---|
| `approval/request` | 审批瀑布，只观察不消费（`return next()` 原样放行） |
| `user-questions/request` | 模型提问瀑布，同上 |
| `api-session/status` | 会话 running 状态，取 `true -> false` 边沿 = 回合结束 |

## 诊断通道（**长期保留**）

浏览器里发生的事对外部完全不可见，所以两个半之间有两条专属通道，**永久开启**，
以后任何时候通知行为不对，先看这里，不用改代码、不用加日志：

| 端点 | 方向 | 作用 |
|---|---|---|
| `POST /api/desktop-notify/report` | 浏览器 → 宿主 | 上报每个决策：事件是否到达、被哪道闸拦下、`new Notification()` 是否抛异常、环境快照 |
| `GET /api/desktop-notify/selftest` | 浏览器 → 宿主 | 返回自检开关状态、trace 与开关的实际路径 |

### 文件在哪

默认写在 `<DSH_HOME|~/.dsh>/desktop-notify/trace.jsonl`，用环境变量 `DSH_DESKTOP_NOTIFY_TRACE`
可以整体改到别处（自检开关 `selftest.flag` 始终与 trace 同目录）。目录不存在时自动创建，
**代码里没有任何写死的机器路径**。把 `DSH_DESKTOP_NOTIFY_TRACE` 设成 `off`（或
`0` / `false` / `none` / `no`）则**完全关掉**写入，端点与自检仍然可用。

trace **自轮转**：超过 512 KB 自动裁掉前半、只保留最近 256 KB（按行边界裁，JSONL 始终可解析），
长期开着也不会涨到失控。

### 怎么读

| kind | 含义 |
|---|---|
| `host-apply` | 宿主半装载（pid / Electron / Node 版本 / trace 路径） |
| `client-apply` | 浏览器半装载，附环境快照（origin / 安全上下文 / 权限 / hidden / hasFocus） |
| `event` | 事件真的到达了浏览器半 |
| `suppressed` | 被闸门拦下，`reason` 是 `window-in-front` / `duplicate` / `no-permission-api` |
| `shown` | 通知真的弹了（`forced:true` 表示自检强制弹） |
| `threw` | `new Notification()` 抛异常，`message` 是原因 |
| `apply-failed` | 浏览器半**装载时**就抛了（典型原因：DSH 升级把服务或事件改名）——这条能避免"插件装着但永远不响"被误判成没装好 |

```sh
node tools/trace.mjs          # 统计 + 最近 15 条
node tools/trace.mjs --all    # 全量
```

### 自检

在同目录放一个 `selftest.flag`（即 `<DSH_HOME|~/.dsh>/desktop-notify/selftest.flag`），
下次页面加载 2 秒后，会**无视前后台**强制弹一条标题为「通知自检」的 Toast —— 用来区分
「代码没跑」和「系统不显示」。自检完记得删掉，否则每次加载页面都会弹。

## 测试

```sh
npm test
```

假 DOM + 假 Notification + 假 fetch，把浏览器半当成普通模块跑一遍：15 项断言覆盖三个事件、
分类、前台抑制、去重、子代理静默、冷启动边沿、点击（`window.focus`）与自检强制弹出。
**不需要启动 DSH**。

## 验收记录

| 时间 | 场景 | 结果 |
|---|---|---|
| 2026-10-01 | 通道自检（强制弹，忽略前台） | ✅ 截图确认，trace `shown forced:true` |
| 2026-10-01 | 回合结束 + 会话摘要（真实路径） | ✅ 截图确认，trace `shown forced:false`，标题「任务已完成」，正文含会话名 |
| 2026-10-01 | 前台抑制（真实场景） | ✅ trace `suppressed window-in-front` |
| 2026-10-11 | 重启后 trace 落到新路径 | ✅ `host-apply` 记录 `~/.dsh/desktop-notify/trace.jsonl`，`traceEnabled:true` |
| 2026-10-11 | **提问类**通知（真实触发） | ✅ trace `event` 抓到完整问题正文；当时正在看客户端 → `suppressed window-in-front`（按设计不弹） |
| 待测 | 等待授权（命令类 / 文件类） | ⏳ 复用同一段 `raiseOnce` + 分类逻辑，冒烟测试已覆盖 |

## 已知限制

- 「点击通知切回客户端」依赖 `window.focus()`，是尽力而为；Electron 不保证把窗口
  提到最前。preload 暴露的 `dshDesktop` 里没有 focus/flash 接口，要 100% 保证就得改
  `app.asar` 的主进程代码，会被客户端更新覆盖，暂不做。
- 只有客户端进程还活着才可能收到通知；完全退出客户端就收不到。

## 致谢与来源

**用了别人的，就说出来。** 这个插件的实现是新的，但接口规范、事件契约和部分工程写法
都来自下面这些项目，逐条列清楚。

### 一、直接借用

- **[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（MIT）** —— 宿主平台与插件规范本身。
  - 宿主半 `export default { inject, apply }` 的形状、`cordis.patch.yml` 的 `insert` 行格式，
    来自它的 loader / bundle 约定；
  - 浏览器半 `window.__ModuleLoader__.load({ id, factory })` + `exports.apply` /
    `exports.inject` 这套包装样板，是照它自带的 `@deepseek-ai/dsh-client-ui-approval`
    产物写的 —— 这是加载器的硬性接口，不是可以自由发挥的地方。
- **DSH 自带包 `@deepseek-ai/dsh-client-ui-approval` / `-user-questions` / `-session`（MIT）**
  —— 本插件订阅的三个客户端事件 `approval/request`、`user-questions/request`、
  `api-session/status` 的名字与语义，都是从这几个包读出来的；本插件只是订阅者。
- **[AwesomeHou/dsh-plugin-marketplace](https://github.com/AwesomeHou/dsh-plugin-marketplace)（MIT）**
  —— `ctx.webServer.register({ kind: 'exact', path, handler })` 与 `readJsonBody()` /
  `json()` 这组 HTTP 小工具的写法，以及 `cordis.patch.yml` 里 `- insert:` 的格式，
  参考了它的实现。

### 二、同类先例（思路不新，必须说明）

写这个插件时**并没有参考它们的代码**（顺序是：先读 DSH 源码 → 先写完插件 → 之后才在
插件市场里搜到同类），但这个方向早就很挤。公开时说明清楚，以免被误认为首创：

- [omdsh-dev/dsh-notification](https://github.com/omdsh-dev/dsh-notification) —— 回合结束通知，
  README 明写 "Only notify when the task is out of view"，即前台抑制；
- [Aisland-SJL/dsh-reminder](https://github.com/Aisland-SJL/dsh-reminder) —— 完成 + 等待批准 +
  点击回窗口 + 提示音；
- [MuziIsabel/dsh-win-notify](https://github.com/MuziIsabel/dsh-win-notify) —— Windows 原生 Toast +
  审批/提问 + 聚焦感知抑制；
- [610la/dsh-notification-center](https://github.com/610la/dsh-notification-center) —— 完成 / 报错 /
  等待批准 + 多种音效 + 设置页。

### 三、本插件自己的部分

- 上下文分类与摘要提取（标题随情况变化：授权 / 改文件 / 提问 / 完成）；
- 常驻诊断通道（report 端点 + JSONL trace + 自动轮转 + 自检开关）；
- 假 DOM 冒烟测试。
