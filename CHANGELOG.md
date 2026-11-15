# CHANGELOG

本文件记录所有值得注意的变更。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## 版本策略

- `0.x` 期间：次要版本（`0.1` → `0.2`）**可能包含破坏性变更**，会在本节明确写出迁移步骤。
- 补丁版本只做修复，不改变配置语义、不改变生成物路径。
- 任何影响「已写入 DSH 信任配置」或「frpc 配置格式」的变更，都会在条目中标注 `⚠ 需重启 DSH` 或 `⚠ 需重建隧道`。
- 发布物：GitHub Release 附 `dsh-tunnel-<version>.tgz`（`npm pack` 产物），tag 形如 `v0.1.0`。

## [Unreleased]

暂无。

## [0.1.2] - 2026-11-15

### 修复

- **按钮文字看不见**：原来用品牌色/透明作按钮底色，碰上「深色面板 + 浅色按钮」的主题组合就变成白字白底。现在按钮改为 `div[role=button]`，底色用中性的半透明灰、文字 `color: inherit`，任何主题下都跟着面板的文字色走；键盘 Enter/Space 仍可触发。
- **状态卡标签错位**：`frpc` 重复两次、本机端口误用 `remotePort` 当标签、错误行标签写成「出错」；改为「DSH 监听 / 公网地址 / 本机端口 / frpc 版本 / frpc 路径 / 最近错误」。
- **杀软锁导致的启动失败没有解释**：新增 `describeSpawnFailure()`，把 `EACCES/EPERM/Access is denied/拒绝访问` 翻译成「被杀软或权限拦住，请把插件数据目录加入信任区后重试」（首次启动常被扫描锁定，重试即成功）。
- **TLS 失败与 token 失败未区分**：日志里出现 TLS 握手错误时给出「检查启用传送 TLS / tlsServerName」的提示，不再笼统归为 token 问题。
- **未配置公网地址时密钥含义不清**：手机登录卡片现在会说明「这串密钥目前只能用于本机访问，且每次 DSH 重启都会变」。

### 新增

- **启动前探测 frpc**：插件加载后 1.5 秒解析二进制并读取 `frpc -v`，设置页无需先点「启动」就能看到版本与路径；结果同时写进 `state.json` 与插件日志。
- **`docs/CONFIGURATION.md`**：逐项配置参考——取值格式、默认值、可抄示例、常见写错方式、frps/frpc 对照样例、自检命令（`frpc -v` / `frpc verify -c`）与失败信息对照表。
- 用真实 `frpc v0.71.1` 验证过插件生成的 `toml` 与 `ini` 配置（`frpc verify -c` 均返回 syntax is ok）。
- 测试增至 **94** 个（新增执行被拦、TLS 失败两类用例）。

## [0.1.1] - 2026-11-15

### 修复

- **侧栏入口点击无反应**：DSH 桌面壳（Electron）对 `window.open` 返回 `deny`，且 http(s) 目标会被转给系统浏览器（那里没有 DSH 会话）。改为在应用内浮层（`shell.overlay`）打开同一套控制界面，不再新开窗口。
- **设置页看不到本插件**：新增 `settings.section` 页面（设置 → 公网隧道）与 `settings.section.icon` 导航图标。
- **界面语言回落成英文**：`LocaleSnapshot` 的字段是 `active`，此前读取不存在的 `id`/`locale`；字典也改为按扁平键注册到客户端 locale 服务。
- **浮层按钮不可点**：`shell.overlay` 层本身是点击穿透的，浮层根节点需要显式 `pointer-events: auto`。
- **保存后误报失败**：保存会重启插件并可能切断该次 HTTP 响应；改为把传输错误当「未知」，回读实时状态确认。

### 变更

- 浏览器侧界面改写为原生 React：设置页与浮层共用一个面板，不再依赖独立标签页；`/dsh-tunnel/` 页面保留为直接访问与排障入口。
- 缺失 frpc、缺少 token 时都会写入插件日志，便于对照状态页排障。
- 新增 `test/client.test.js`：在假 module loader + 假 React 下真实执行浏览器模块，校验三个 slot 的注册、双语标签、渲染不抛错、且不出现 `window.open`。

## [0.1.0] - 2026-11-15

首个可用版本，目标是把「让手机上固定公网地址安全访问本机 DSH」的电脑侧工作固化成插件。

### 新增

- 插件骨架：bundle patch 插入 `dsh-tunnel` 行，浏览器侧在侧栏底部注册「公网隧道」入口（带运行状态点）。
- 配置 schema（`schemastery`）：frp 服务器地址/控制端口/内部代理端口、公网地址、代理名、frpc 路径、frp 版本、
  配置格式（toml/ini）、TLS、重启退避、额外受信 Host、Cookie 有效期、自动应用开关、数据目录、日志行数。
- **DSH 信任补丁**：通过官方 `configEditor` 写入 `connection.trustedHosts` 与 `cookieMaxAgeDays`；
  重写时保留启动参数中的 `--trusted-host` 值，避免按行覆盖导致公网 Host 失信；「恢复默认」时删回覆盖行。
- **frpc 托管**：解析二进制（配置路径 → 托管目录 → PATH）、`frpc -v` 版本比对与告警、
  按 DSH 实际端口生成 TOML/INI 配置、启动/停止/重启、指数退避、认证失败提示、孤儿进程按 pid 清理。
- **frp 密钥**：只存 DSH 凭据存储，界面掩码、不导出、不写日志。
- **控制页** `/dsh-tunnel/`：状态、日志（脱敏）、隧道参数、密钥、DSH 信任、手机登录（地址 + 访问密钥，默认隐藏）、
  开机自启（Windows 启动文件夹快捷方式）、配置导出/导入、依赖检查。
- **日志脱敏**：token 与其 URL-encoded 形式、URL 查询串在落盘与返回前统一替换。
- **迁移**：不含密钥与本机路径的 JSON 导出；导入校验 schema 并忽略机器本地键。
- **依赖检查**：检测 `@dsh-harmony/plugin` 是否安装、是否在 profile 的 bundle 列表中。
- 测试：62 个 `node:test` 用例覆盖配置生成、补丁合并（含覆盖陷阱回归）、脱敏、路径推导、导出导入、
  启动项脚本与进程托管状态机。
- 文档：`README.md`（用户 + 开发者）、`docs/DETAIL.md`（插件详情页）、`docs/SECURITY.md`（威胁模型与清理顺序）。

### 已知限制

- DSH 桌面进程未运行时手机不可达（V1 采用运行内插件形态，不额外启动无界面实例）。
- 「开机自启」仅实现 Windows 启动文件夹方案。
- 不自动下载 frpc 二进制，需用户自备。
- 多台电脑共用一个 frps 时需自行保证 `proxyName` 与 `remotePort` 唯一。
