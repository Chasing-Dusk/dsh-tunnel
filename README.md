# dsh-tunnel · DSH 公网隧道

把**这台电脑上的 DSH** 通过一个**固定的公网 HTTPS 地址**（例如 `https://dsh.example.com`）安全地暴露给手机，并把它固化成可安装、可迁移、可卸载的 DSH 插件。

- 手机侧协议由官方 [`@dsh-harmony/plugin`](https://github.com/stlin256/DSH-Harmony) 提供，本插件**不重复实现**任何手机接口。
- 本插件只做四件事：**写 DSH 信任配置**、**生成并守护 frpc 隧道**、**展示手机登录信息**、**可迁移与可拆除**。
- 需要你自己的 frp 服务器（frps + 反向代理 + 域名）。插件默认**不连接任何服务器、不含任何密钥、不含任何真实域名**。

> ⚠️ 装上并启用之后，公网上的任何持有访问密钥的人都能操作这台电脑上的 DSH，等于整机控制权。默认关闭，请按本文的安全段落使用。

---

## 1. 它解决什么问题

DSH 桌面版的 Web 只监听 `127.0.0.1`，端口每次启动随机，启动 token 每进程随机且界面不显示。手机在任何网络下都直连不了。

本插件的做法：

```
手机 DSH-Harmony
  │ https://dsh.example.com（固定域名，证书在你自己的服务器上）
  ▼
你的服务器：Nginx → frps（frp 反向隧道，TLS + token）
  │ frpc 主动出站（家宽不需要公网 IP）
  ▼
本机电脑：dsh-tunnel 托管的 frpc
  │ 127.0.0.1:<DSH 本次实际端口>
  ▼
DSH 实例（已启用 @dsh-harmony/plugin）
```

`dsh-tunnel` 负责其中三段：

| 环节 | 它做什么 |
|---|---|
| 信任 | 把公网域名写进 profile 的 `connection.trustedHosts`，并把 `cookieMaxAgeDays` 调长，让手机「登录一次、长期有效」 |
| 隧道 | 每次 DSH 启动后读取真实端口，生成 frpc 配置、拉起 frpc、崩溃重启、DSH 退出时清理 |
| 展示 | 一个控制页：状态、frp 参数、frp 密钥、DSH 信任、手机登录链接/访问密钥、开机自启、导出/导入 |

---

## 2. 前置条件

1. DSH 桌面版 `0.2.2-rc.*`（插件依赖其 `webServer` / `connection` / `configEditor` 服务）。
2. 已安装并**启用**（profile `package.json` 的 `dsh.profile.bundles` 中列出）`@dsh-harmony/plugin`。
3. 自备 frp 服务器：`frps` 的**控制端口**可从本机访问，服务器反代已把公网域名转发到 frps 的代理端口。frps 与 frpc **版本必须一致**。
4. 本机已放好 `frpc` 可执行文件（见 §4）。
5. 手机端 DSH-Harmony App。

---

## 3. 安装

### 3.1 从 GitHub Release 安装（推荐）

在 DSH 的 **插件** 页安装下面这个地址，或把它加入 profile 的 `dependencies`：

```
https://github.com/LittleWorkhorseProMax/dsh-tunnel/releases/download/v0.1.0/dsh-tunnel-0.1.0.tgz
```

### 3.2 从本地目录安装（开发用）

```powershell
# 在 DSH「插件」页选择「添加本地插件」，指向这个目录：
git clone https://github.com/LittleWorkhorseProMax/dsh-tunnel.git
```

安装完成后该 bundle 会插入一行 `dsh-tunnel`，浏览器侧同时出现两个入口。

### 3.3 打开控制页

有三个等价入口：

| 入口 | 位置 |
|---|---|
| **设置 → 公网隧道** | 设置面板左侧导航（推荐，常驻） |
| **侧栏底部隧道图标** | 侧栏最下方、账户头之上；图标上的小圆点是隧道状态（灰=未连、黄=连接中、绿=已连接）。点击打开应用内浮层，再次点击或按 `Esc` 关闭 |
| **直接 URL** | `http://127.0.0.1:<当前端口>/dsh-tunnel/`（端口见 DSH 启动日志），适合排障或换浏览器 |

前两个入口都在 DSH 应用内，不新开窗口（桌面壳会拦截 `window.open`）。三个入口都与 DSH 同源，复用你已有的登录 Cookie：没有新的账号密码。

> 单独访问 `/dsh-tunnel/` 页面仍保留，用于排障、迁移说明与"客户端模块没加载"时的兜底。

---

## 4. 准备 frpc（三选一）

插件不联网下载任何东西。按下列任一方式提供 `frpc`：

| 方式 | 做法 | 说明 |
|---|---|---|
| **A. 托管目录（推荐）** | 把 `frpc.exe` 放到 `$DSH_HOME\dsh-tunnel\bin\frpc.exe` | 卸载时随目录一起清理，最干净 |
| **B. 指定路径** | 控制页「frpc 路径」填绝对路径 | 换机器后需重填（导出配置不含路径） |
| **C. PATH** | 把 `frpc.exe` 所在目录加入 `PATH` | 插件会自动找到 |

获取方式：从 frp 官方 release 下载与你服务器**同版本**的 **Windows amd64** 压缩包（文件名形如 `frp_<版本>_windows_amd64.zip`），解出 `frpc.exe`。校验下载完整性后放入上面的目录。

> 注意：`frp_<版本>_linux_amd64` 里的 `frpc` 是 Linux 二进制，Windows 上无法运行；请确认是 `windows_amd64`。
>
> 若杀毒软件（如火绒）把 `frpc.exe` 隔离过，把 **`%USERPROFILE%\.dsh\dsh-tunnel\bin`** 整个目录加入信任区，再从隔离区恢复，避免下次启动又被拦掉。插件本身不会联网下载任何二进制。

```powershell
# 登录后恢复到 PATH 的方式示例（仅说明，无脚本依赖）
$env:DSH_HOME   # 通常是 C:\Users\<你>\.dsh
```

插件会执行 `frpc -v` 读取版本；与「frp 版本」配置不一致时会在状态页与日志中明确警告。

---

## 5. 配置项

控制页、profile 的 `cordis.patch.yml` 或插件管理页都可以改。**默认值全部是惰性的**：没有服务器、没有域名、隧道关闭。

> 每一项的**取值格式、可抄的示例、常见写错方式、失败信息对照表**见 **[docs/CONFIGURATION.md](docs/CONFIGURATION.md)**。下面只是速查。

| 键 | 默认 | 说明 |
|---|---|---|
| `enabled` | `false` | 随 DSH 启动自动拉起隧道 |
| `serverAddr` | `''` | frps 地址（本机可达），如 `vps.example.com` |
| `serverPort` | `7000` | frps 控制端口 |
| `remotePort` | `19098` | 服务器内部代理端口（经 Nginx 转发，不对外） |
| `publicUrl` | `''` | 手机填写的固定地址，如 `https://dsh.example.com`；其 host 会自动写入 `trustedHosts` |
| `localHost` | `127.0.0.1` | frpc 转发目标 |
| `proxyName` | `dsh-desktop` | 在 frps 上的代理名，同一服务器内唯一 |
| `frpcPath` | `''` | 留空自动查找（托管目录 → PATH） |
| `frpVersion` | `''` | 与服务器一致的版本，用于比对告警 |
| `frpConfigFormat` | `toml` | frp v0.52+ 用 `toml`，更早用 `ini` |
| `tls` | `true` | frp 传输 TLS |
| `tlsServerName` | `''` | 用 IP 连 frps 但证书是域名时填写 |
| `restartBaseDelayMs` / `restartMaxDelayMs` | `2000` / `60000` | 崩溃重启退避 |
| `trustedHosts` | `[]` | 额外受信 Host（如局域网 `192.168.1.20:3080`） |
| `cookieMaxAgeDays` | `3650` | 登录 Cookie 有效期（DSH 默认 30） |
| `autoApplyTrust` | `true` | 配置了 `publicUrl` 后自动写入信任补丁 |
| `dataDir` | `''` | 空 = `$DSH_HOME/dsh-tunnel` |
| `keepLogLines` | `400` | 状态页保留的 frpc 日志行数 |

**frp token 不是配置项**：它只存在 DSH 凭据存储（键 `dsh-tunnel:frp-token`），界面只显示「已保存 / 未设置」，不会回显、不会导出、不会进日志。

**三条铁律**（绝大多数失败都出在这里）：frp 版本两端一致；TLS 与 frps 的 `transport.tls.force` 对齐；`remotePort` 落在 frps 的 `allowPorts` 里。

---

## 6. 首次使用（约 5 分钟）

> **跟着界面一步步做**：[docs/SETUP-GUIDE.md](docs/SETUP-GUIDE.md) —— 按「填哪一格、看到什么算成功、失败怎么查」写，推荐先看这个。
> 每个字段的格式与示例：[docs/CONFIGURATION.md](docs/CONFIGURATION.md)。

1. 装插件 → 侧栏打开控制页。
2. 保存 **frp 密钥**（`frps` 与 `frpc` 之间的共享口令，写在服务器的 `frps.toml` 的 `auth.token` 里；不是插件生成的。取法见 [SETUP-GUIDE §2](docs/SETUP-GUIDE.md#2-填frp-密钥)）。
3. 填 `frp 服务器地址`、`frp 控制端口`、`公网地址`、`服务器内部代理端口`、`frp 版本`（与服务器一致），保存。
4. 点 **应用**（DSH 信任配置）→ 若页面提示「需要重启 DSH」，重启 DSH。
5. 状态区应显示「已连接 / 运行中」；日志出现 `login to server success` 与 `start proxy success`。
6. 「手机登录」区点 **显示访问密钥**，把 `服务地址`（= `publicUrl`）和 `访问密钥` 填进手机 App，登录方式选「访问密钥」。
7. 手机上关掉 Wi-Fi 用蜂窝网络再试一次，确认公网链路可用。

---

## 7. 状态与日志怎么看

| 字段 | 含义 |
|---|---|
| DSH 监听 | 本机真实 origin / 端口（每次启动可能变化，插件会自动跟随） |
| 公网地址 | 手机填写的地址 |
| frpc 版本 / 路径 | 实际使用的二进制；`未找到` 表示需要按 §4 放置 |
| 生成的配置 | 每次启动重写，位于 `$DSH_HOME\dsh-tunnel\frpc.toml` |
| 状态徽标 | `运行中` 进程在 → `已连接` 登录成功 → `未连接` 已登录但代理未就绪 → `重试中` 退避重启中 → `缺少 frpc` / `配置不完整` 需要人处理 |
| 日志 | frpc 的 stdout/stderr，**已脱敏**（token 与 URL 中的 `token=` 参数都会被替换） |
| DSH 信任 | `已生效` = 当前进程已接受公网 Host；`需要重启 DSH` = 补丁已写但还没生效 |

排障顺序：DNS → 443（502 表示 Nginx 到了但 frps 没代理）→ frps 是否收到 frpc 登录 → frpc 是否连上 → DSH 端口是否正确 → 信任配置是否生效。

---

## 8. 电脑重启后如何自动恢复

非管理员账户无法注册 Windows 服务或计划任务，唯一可行路径是**「启动」文件夹快捷方式**：

- 控制页「开机自启」→ **创建启动项**：在 `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup` 写入一个指向 DSH 可执行文件的快捷方式。
- 登录 Windows 后 DSH 自动启动 → 插件加载 → `enabled=true` 时自动拉起 frpc。
- 不想要就点 **移除启动项**；插件只删除自己记录过的那个快捷方式。

**明确限制**：DSH 桌面进程没运行时，手机不可达。要么保持 DSH 常驻（并把电源计划设为不休眠），要么接受「先打开 DSH 才能连」。若需要「电脑开着但没开 DSH 也能连」，那是另一套形态（专用无界面实例），不在 V1 范围内。

---

## 9. 迁移（换电脑 / 换服务器）

**换电脑**：装 DSH → 装插件 → 控制页 **导入配置**（JSON）→ 重新填 frp token → 点应用 → 重启 DSH → 手机（域名不变时）无需改地址，Cookie 未过期则免登录。

**换服务器**：改 `serverAddr` / `serverPort` / `remotePort` / `frpVersion`，重新填新 token。

**换域名**：改 `publicUrl` → 应用 → 重启 DSH → 手机改地址并**重新登录一次**（Cookie 绑定 authority）。

导出文件只有地址与端口，不含 token、不含访问密钥、不含本机路径（`frpcPath`、`dataDir` 属于机器本地设置，导出时忽略、导入时保留本机值）。

---

## 10. 卸载与拆除

按顺序：

1. 控制页 **停止隧道**。
2. **移除启动项**。
3. **恢复默认**（DSH 信任配置）— 把 profile 的 `connection` 行覆盖项删掉，恢复出厂表达式。
4. 插件页 **移除** `dsh-tunnel`。
5. 清理（可选，凭据与生成物）：
   - 目录 `$DSH_HOME\dsh-tunnel`（含生成的 frpc 配置、日志、状态）
   - DSH 凭据中的 `dsh-tunnel:frp-token`
6. 服务器侧按你自己的约定拆 frps / 站点（本项目不涉及）。

禁用（而不是移除）插件时，`ctx.effect` 的清理会停掉 frpc，不会留下孤儿进程。

---

## 11. 安全说明（请读完）

- **这是高权限远程入口**：拿到访问密钥或有效 Cookie 的人可以像你本人一样操作这台电脑。默认 `enabled=false`，不使用就别开。
- **两把钥匙**：
  - *frp token*：能占用/冒用隧道。存 DSH 凭据存储；界面掩码；不导出、不写日志。
  - *DSH 访问密钥*：每进程随机，**泄露即等于整机控制权**。只在本机控制页「显示」时可读，不落盘、不写日志、不上传。
- **日志脱敏**：frpc 输出在进入缓冲、写文件、返回前端之前都会替换 token 与 URL 查询串。
- **不收集任何数据**，无遥测，除你配置的 frp 服务器外不连接任何外部服务。
- **不改 DSH 核心**：只使用公开的插件机制与 profile 配置层（`configEditor`）。不绕过信任栅栏、不关闭任何安全校验。
- **控制页只对已认证的本机会话开放**：每个请求都经过 DSH `connection` 的 Host/Origin 围栏；所有写操作额外要求 `x-dsh-tunnel: 1` 请求头（跨站表单无法伪造）。
- **公网侧**建议：只暴露 HTTPS 443；frps 控制端口限制来源；给隧道单独设 token 并定期轮换；不需要时停用隧道。

详见 [docs/SECURITY.md](docs/SECURITY.md)。

---

## 12. 开发者文档

### 12.1 形态与生命周期

- 运行形态：**运行内插件**（挂在桌面版 DSH 上）。DSH 进程退出 → 插件 `ctx.effect` 清理 → frpc 停止。
- 端口跟随：frpc 配置在**每次 start 前**用 `ctx.webServer.getOrigin()` 重新生成，因此 DSH 换端口后自然跟随（DSH 重启时插件也重启）。
- 崩溃恢复：子进程 `exit` → `backoff` → 指数退避重启（`nextBackoff`）。
- 孤儿处理：state 记录 frpc pid；下次启动若该 pid 仍是 `frpc.exe` 则 `taskkill`，避免旧隧道占着 frps 代理名。

### 12.2 模块

| 文件 | 职责 |
|---|---|
| `index.js` | 插件入口：注册路由、启动 supervisor、延时自动写信任补丁、清理 |
| `src/config.js` | `schemastery` 配置 schema（供 DSH 校验与展示） |
| `src/config-values.js` | 默认值/归一化/`publicUrl`→authority（无外部依赖，可单测） |
| `src/trust.js` | **信任补丁合并**（纯函数）：`planTrustPatch` / `planTrustRevert` / `findConnectionRow` |
| `src/frpc-config.js` | frpc 的 TOML/INI 生成、转义、origin→端口 |
| `src/frpc.js` | frpc 进程托管：解析二进制、`-v` 比对、生成配置、启动/停止/退避/僵尸清理 |
| `src/control.js` | 控制页与 JSON API、凭据写入、导出/导入、启动项 |
| `src/page.js` | 单文件 HTML 控制页（无构建步骤，全部文本用 `textContent` 注入） |
| `src/credentials.js` | frp token 的凭据记录读写与校验 |
| `src/startup.js` | 「启动」文件夹快捷方式（PowerShell `WScript.Shell`，无需管理员） |
| `src/paths.js` | 全部路径推导（无绝对路径假设） |
| `src/secrets.js` / `src/logs.js` | 掩码、脱敏、有界日志 |
| `src/migrate.js` | 配置导出/导入（不含密钥） |
| `src/harmony.js` | 检测 `@dsh-harmony/plugin` 是否安装且已启用 |
| `client.js` | 浏览器侧：侧栏底部入口 + 状态点 |

### 12.3 信任补丁为什么这样写

DSH 的 profile 补丁**按行 id 覆盖且替换整行 config**。`connection` 行的出厂配置是：

```yaml
trustedHosts: !!js ctx.webStartup.trustedHosts
```

所以「只写 `cookieMaxAgeDays`」会把这个表达式一起覆盖掉，公网 Host 直接失信。本插件的做法：

1. 从 profile 层读出该行的 `inherited`（bundle 层）与当前 `override`；
2. 收集「运行期启动参数里的 `--trusted-host` 值」+ 两层的字面量条目 + 本次要加的 `publicUrl` host；
3. 重新写出一份**完整**的行配置：`trustedHosts` 为字面量数组（表达式已被解析成当前值，等价且不依赖表达式在启动后的可用性），`cookieMaxAgeDays` 为目标值，其它继承键原样保留；
4. 通过 DSH 官方 `configEditor.edit()` 落盘（它负责校验、序列化、加锁与热重组），**不手写 YAML**；
5. 「恢复默认」时写回与 `inherited` 完全相等的对象，编辑器会把覆盖行整行删除 —— 卸载无残留。

上面的行为有专门测试：`test/trust.test.js` 的 *the cookieMaxAgeDays write keeps the public host trusted* 等用例。

### 12.4 测试

```powershell
cd dsh-tunnel
node --test        # 62 个用例：配置生成、补丁合并、脱敏、路径、导出导入、启动项脚本、进程托管状态机
```

测试不依赖 DSH 运行时（`src/config-values.js` 与其余模块均无第三方依赖），可直接用普通 Node 20+ 跑。

### 12.5 接口契约

- 路由：`/dsh-tunnel`（页面）、`/dsh-tunnel/api/*`（JSON）。
- 鉴权：`ctx.connection.requestRejection(req)` 必须返回 `undefined`；所有 `POST` 需要请求头 `x-dsh-tunnel: 1`。
- 页面头：`Content-Security-Policy` 禁止外链、禁止被 iframe、禁止表单外发。
- 凭据键：`dsh-tunnel:frp-token`（`kind: 'api-key'`）。
- 数据目录：`$DSH_HOME/dsh-tunnel`（`frpc.toml`、`logs/frpc.log`、`state.json`）。
- 版本兼容：DSH `>=0.2.2-rc.1 <0.3.0`；`@dsh-harmony/plugin` `0.4.x`（对应 App 0.4.10）。

### 12.6 服务器侧契约（摘要）

参数以你项目里的 `03-接口与配置契约.md` 为唯一来源。插件侧就三点：

1. `serverAddr`/`serverPort` = frps 控制入口；
2. `remotePort` = frps 暴露给 Nginx 的内部代理端口；
3. Nginx 必须**原样透传** `Host` 与 `Origin`、支持 WebSocket 升级、`client_max_body_size` ≥ 300 MiB。

---

## 13. FAQ

**Q: 状态显示「缺少 frpc」？** 按 §4 放好二进制，或填 `frpcPath`。
**Q: 日志 `authorization failed`？** token 不对或 frps 的 token 已轮换；重新保存 frp 密钥。
**Q: 手机登录报 403 / Untrusted origin？** `trustedHosts` 没生效：点应用、重启 DSH，确认状态区为「已生效」。
**Q: 手机能登录但一会儿就断？** 多半是 Nginx 的 WebSocket/`proxy_read_timeout` 或请求体上限，属服务器侧配置。
**Q: 重启 DSH 后手机要重登吗？** 不需要。签名 Cookie 的密钥持久化在 DSH_HOME，token 变了但 Cookie 仍有效（域名不变、未过期前提下）。
**Q: 能多台电脑共用一个服务器吗？** 可以，每台用不同 `proxyName` 与 `remotePort`。
**Q: 支持 Linux/macOS 的 DSH 吗？** frpc 托管与信任补丁与平台无关；「开机自启」目前只实现 Windows 启动文件夹。

---

## 14. 版本与许可

- 版本策略见 [CHANGELOG.md](CHANGELOG.md)：语义化版本，`0.x` 期间次要版本可能带破坏性变更。
- License: MIT。内置图标为本项目原创。

[![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)
