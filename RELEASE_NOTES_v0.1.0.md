# v0.1.0 — 桌面通知

给 DeepSeek Harness 补上官方客户端**完全没有**的通知能力。首个公开版本。

客户端最小化、或被别的窗口盖住时，你既看不到「需要你授权」的审批卡片，也不知道回合
什么时候跑完。这个插件在那些时刻弹一条系统通知，并且**正文里带上任务摘要**。

## 亮点

- **按情况换标题**：授权类写「有任务需要授权」、改文件写「有文件需要修改」、模型提问写
  「有问题需要你回答」、回合结束写「任务已完成」—— 一眼知道要做什么，而不是一句
  "有新消息"。
- **摘要不是硬编码**：审批请求里本来就带着模型写的 justification，插件把它剥掉
  `escalate sandbox to <mode>:` 这层机器前缀，剩下的人话直接进正文。
- **前台不打扰**：窗口有焦点、页面可见时一律不弹；子代理会话静默；冷启动本就 idle 的
  会话不误报（只认 `running: true -> false` 这个真实边沿）；同一事件 1.5 s 内只弹一次。
- **常驻诊断通道**：浏览器半把每个决策（事件到达 / 被哪道闸拦下 / `new Notification()`
  是否抛异常）上报给宿主半，落成可读的 JSONL trace。渲染进程本来是黑盒，现在不是了。
  trace 自动轮转，长期开着也不会涨到失控；还有一个"无视前后台强制弹一条"的自检开关，
  用来区分「代码没跑」和「系统不显示」。
- **零依赖**：不引任何 npm 包，只用宿主自带能力。

## 安装

```bash
dsh plugin --profile desktop add github:LeeRolling/dsh-plugin-desktop-notify
```

重启客户端生效。

## 用法

**先把消息发出去，再立刻切走。** 回合是从你按下发送开始的，切走之后事件才会发生在你
不在场的时候；反过来（先切走再回来打字）会把你带回前台，按设计就不弹了。

排查用：

```bash
node tools/trace.mjs
```

## 测试

```bash
npm test
```

15 项断言，假 DOM + 假 Notification + 假 fetch，**不需要启动 DSH**。

## 已验证环境

DSH Desktop `0.2.0-rc.2`（Electron 44）· Windows 11 · `desktop` profile。
验收记录（含两次截图确认 + trace 行）见 README。

## 版权与署名

版权记在 `dsh-plugin-desktop-notify contributors` 名下（见 LICENSE）。本插件的代码由
DeepSeek Harness 的 AI 助手在本项目需求驱动下编写。

## 致谢与来源

**用了别人的，就说出来。** 这个插件的实现是新的，但接口规范、事件契约和部分工程写法
都来自下面这些项目，逐条列清楚：

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
  —— `ctx.webServer.register({ kind: 'exact', path, handler })` 与
  `readJsonBody()` / `json()` 这组 HTTP 小工具的写法，以及 `cordis.patch.yml` 里
  `- insert:` 的格式，参考了它的实现。

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

- 上下文分类与摘要提取（标题随情况变化）；
- 常驻诊断通道（report 端点 + JSONL trace + 自动轮转 + 自检开关）；
- 假 DOM 冒烟测试。