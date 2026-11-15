# 安全说明 · dsh-tunnel

本插件的作用是**在公网上开一个通往本机 DSH 的入口**。请把它当成「远程桌面级」的信任决定，而不是一个普通小工具。

## 1. 威胁模型

| 资产 | 谁能拿到 | 泄露后果 |
|---|---|---|
| **DSH 访问密钥**（每进程随机 43 字符） | 本机控制页显式点击「显示」；DSH 启动链接 | 持有者在密钥有效期内可完全操作本机 DSH，等于整机控制权 |
| **DSH 签名 Cookie** | 手机 App（登录后） | 同上；有效期由 `cookieMaxAgeDays` 决定（本插件默认 3650 天） |
| **frp token** | 本机 DSH 凭据存储；frps 配置 | 可冒用/占用来隧道，把公网入口劫持到攻击者机器 |
| **公网域名** | 公开信息 | 无直接后果，但它决定 Cookie 的 authority |

威胁来源：公网扫描、隧道凭据泄露、本机其他用户或程序读取配置、日志/截图/录屏外泄。

## 2. 本插件做了什么

### 2.1 密钥最小化

- frp token：只存在 **DSH 凭据存储**（键 `dsh-tunnel/frp-token`，`kind: api-key`），通过官方 `ctx.credentials` 读写。
  - 不进插件配置、不进 profile 的 `cordis.patch.yml`、不进导出的 JSON。
  - 界面只显示「已保存 / 未设置」，接口从不返回明文。
- DSH 访问密钥：**不落盘、不缓存、不写日志**。只有控制页显式请求 `/api/login-info` 时，通过官方 `connection.authenticatedUrl()` 现取现用，响应带 `Cache-Control: no-store`。

### 2.2 生成的 frpc 配置

`$DSH_HOME\dsh-tunnel\frpc.toml` 里必然含有 token（frpc 的配置格式要求）。缓解：

- 文件以 `0600` 写入（Windows 上 POSIX 位不生效，真正的边界是 `%USERPROFILE%` 的 NTFS ACL：仅当前用户、SYSTEM、Administrators 可读）；
- 每次启动重写，不手工维护、不进版本库；
- 目录 `$DSH_HOME\dsh-tunnel` 在 `.gitignore` 中不会被误提交。

### 2.3 日志脱敏

frpc 的 stdout/stderr 在**进入内存缓冲、写入日志文件、返回前端**之前统一过一遍 `scrub()`：

- 已知 token 的字面量与 URL-encoded 形式 → `••••••••`
- 任何 URL 的查询串（DSH 的 `?token=` 就在这里）→ `?…`

测试覆盖：`test/secrets.test.js`。

### 2.4 控制页的访问控制

- 页面与 API 都挂在 DSH 自身的 HTTP 服务上，**同源**，因此复用 DSH 的签名 Cookie 会话。
- 每个请求先过 `ctx.connection.requestRejection(req)`：Host 必须在 DSH 信任表内、必须带有效 Cookie，否则 401/403。
- 所有写操作（`POST`）额外要求请求头 `x-dsh-tunnel: 1`：跨站表单无法设置自定义头，因此顺带挡住 CSRF。
- 页面响应带 `Content-Security-Policy: default-src 'none'; script-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; form-action 'none'`，不允许被 iframe、不允许表单外发、不允许加载任何外部资源。
- 页面所有动态文本用 `textContent` 注入，不做 HTML 拼接。

### 2.5 不扩权、不改核心

- 不使用未公开 API、不绕过信任栅栏、不关闭任何安全检查。
- 不安装系统服务、不写注册表、不用 `schtasks`（非管理员环境）。
- 唯一会改动的系统位置：**你点击后**才创建的「启动」文件夹快捷方式，且只删除自己记录过的那个。
- 无遥测、无外部上报；除你配置的 frp 服务器外不连接任何地方。

### 2.6 默认安全

- `enabled=false`：装上不等于开启。
- 无默认服务器、无默认域名、无默认 token、无默认公网地址。
- 传输 TLS 默认开启（`tls=true`）。
- 二进制不会自动下载：装什么版本、从哪来，由你决定。

## 3. 使用者必须做的

1. **只在自己的设备上启用**，用完就「停止隧道」。
2. **不要截图/录屏/粘贴**访问密钥、frp token、带 `?token=` 的链接。
3. **服务器侧收敛暴露面**：只开 443 与（限源的）frps 控制端口；给隧道单独 token；不要开 frps dashboard 公网。
4. **定期轮换 frp token**（轮换后：服务器改 frps 配置 → 本机控制页重新保存密钥 → 重启隧道）。
5. **不需要几个月时**按 README §10 的顺序拆除，并关闭手机上的登录状态。

## 4. 已知残余风险

| 风险 | 说明 | 缓解 |
|---|---|---|
| 本机同用户进程可读到 token 文件与凭据 | 同一 Windows 用户下的恶意程序本就能读几乎一切 | 保证电脑只用受信任的软件；不要把 `$DSH_HOME` 同步到云盘 |
| frpc 配置含明文 token | frp 配置格式要求 | ACL 边界 + 定期轮换 + 不提交版本库 |
| Cookie 长期有效 | `cookieMaxAgeDays` 大 = 手机免重登，也 = 泄露后长期可用 | 需要时可把该值调小并重启 DSH，让所有 Cookie 提前失效 |
| 硬杀 DSH 可能留下孤儿 frpc | Windows 上父子进程不自动绑定 | 下次启动按记录的 pid 校验镜像名后清理；frps 侧同名代理会拒绝新连接，属可观测故障 |
| 「待应用」窗口期 | 补丁已写但 DSH 未重启时公网 Host 不被接受 | 控制页明确显示「需要重启 DSH」，不会假装成功 |

## 5. 报告安全问题

请通过仓库的 Security 区域或 Issues 私下联系维护者，不要在公开 Issue 中附带 token、Cookie、访问密钥或带 `?token=` 的链接。
