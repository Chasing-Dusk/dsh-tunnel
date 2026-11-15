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
