# 字段参考 · dsh-tunnel

> **想按界面一步步配置？** 看 [使用教程 SETUP-GUIDE.md](SETUP-GUIDE.md)——那份按「填哪一格、看到什么算成功」写。
> 本文件是**字段字典**：每个键的取值格式、默认值、示例、以及常见的写错方式。
> 「设置页里的名字」一列即界面上的中文标签；保存后写入 profile 补丁层，不需要手改文件。

> **三条铁律**（90% 的失败都出在这里）
>
> 1. **frp 版本必须与服务器一致**：`frpVersion` ＝ frps 的版本，`frpc` 二进制也必须是同一版本。
> 2. **TLS 必须与 frps 对齐**：服务器写了 `transport.tls.force = true`，这里就必须勾选「启用传送 TLS」。
> 3. **remotePort 必须与 frps 的 `allowPorts` 一致**：服务器只放行某个端口时，这里填别的端口会「登录成功但建隧道失败」。

---

## 1. 隧道参数

| 设置页里的名字 | 配置键 | 格式 | 默认 | 示例 | 说明与常见错法 |
|---|---|---|---|---|---|
| 随 DSH 自动启动隧道 | `enabled` | 布尔 | `false` | 勾选 | 是否随 DSH 启动自动拉起隧道。关闭时仍可点「启动」临时运行。 |
| frp 服务器地址 | `serverAddr` | 主机名或 IP，**不带协议、不带端口、不带路径** | 空 | `vps.example.com`<br>`8.130.36.4` | 本机可达的 frps 地址。写成 `http://vps.example.com:7000` 会登录失败。 |
| frp 控制端口 | `serverPort` | 整数 1–65535 | `7000` | `7000` | frps 的**控制端口**（`bindPort`），不是公网 443。 |
| 公网地址（手机填写） | `publicUrl` | `http(s)://host[:port]`，**不带路径 / 查询串 / 账号信息** | 空 | `https://dsh.example.com` | 手机里填写的服务地址。它的 host 会被写进 DSH 的 `trustedHosts`。写成 `dsh.example.com`（缺协议）或 `https://x.com/path` 都会被拒绝。 |
| 服务器内部代理端口 | `remotePort` | 整数 1–65535 | `19098` | `19098` | frps 暴露给反向代理的端口。必须落在 frps 的 `allowPorts` 里。 |
| 代理名（每台机器唯一） | `proxyName` | `[A-Za-z0-9_.-]`，1–64 字符 | `dsh-desktop` | `dsh-desktop`<br>`dsh-office-pc` | frps 上的代理名，**同一服务器内唯一**。两台电脑用同一个名字会互相顶掉。 |
| 本机目标地址 | `localHost` | 主机名或 IP | `127.0.0.1` | `127.0.0.1` | frpc 转发到本机的地址。DSH 桌面版绑回环，保持默认。 |
| frp 版本（与服务器一致） | `frpVersion` | `x.y.z` | 空 | `0.71.1` | 期望版本，只用于**比对告警**：插件的 `frpc -v` 与它不一致时写日志提醒。 |
| 配置格式 | `frpConfigFormat` | `toml` / `ini` | `toml` | `toml` | frp **v0.52 及以后用 `toml`**，更早用 `ini`。选错会让 frpc 启动即退出。 |
| 启用传送 TLS | `tls` | 布尔 | `true` | 勾选 | frp 传输层 TLS。frps 写了 `transport.tls.force = true` 时必须勾选。 |
| TLS ServerName（可选） | `tlsServerName` | 主机名 | 空 | `frp.example.com` | 用 IP 连 frps、但希望按服务器证书名做 SNI 时填写；通常留空。 |
| frpc 路径（留空自动查找） | `frpcPath` | 绝对路径 | 空 | `D:\tools\frpc.exe` | 留空时按「托管目录 → PATH」自动查找；托管目录是 `$DSH_HOME\dsh-tunnel\bin\frpc.exe`。 |
| 登录 Cookie 有效期（天） | `cookieMaxAgeDays` | 整数 ≥1 | `3650` | `3650` | 登录 Cookie 有效期。DSH 默认 30 天——决定「多久要回电脑旁重新取一次密钥」。 |
| 额外受信 Host（逗号分隔） | `trustedHosts` | 逗号分隔的 authority（`host` 或 `host:port`，**不带协议**） | 空 | `192.168.1.20:3080, nas.example.com` | 除 `publicUrl` 的 host 之外额外允许访问 DSH 的地址（例如局域网直连）。填 `https://…` 会被判非法并记录日志。 |
| 自动写入 DSH 信任配置 | `autoApplyTrust` | 布尔 | `true` | 勾选 | 配置了 `publicUrl` 后，插件启动时自动写回信任补丁；内容不变则不重复写，避免反复重载连接服务。 |

隐藏项（一般不用改）：`restartBaseDelayMs`（崩溃后首次重试等待，默认 2000 ms，之后指数翻倍）、`restartMaxDelayMs`（上限，默认 60000 ms）、`dataDir`（默认 `$DSH_HOME\dsh-tunnel`）、`keepLogLines`（日志保留行数，默认 400）。

---

## 2. frp 密钥（不是普通配置项）

| 项 | 说明 |
|---|---|
| 它是什么 | frps 与 frpc 之间的**共享口令**，用来防止别人连你的隧道。 |
| 谁生成 | **谁搭服务器谁定**。写在服务器 `frps.toml` 的 `auth.token` 里；frps 不会自动生成，插件和 DSH 也不会。 |
| 客户端要求 | 每一台电脑的 frpc 必须填**完全一样**的一串，否则 frps 拒绝登录：`token in login doesn't match token from configuration`。 |
| 存放位置 | DSH 凭据存储，记录键 `dsh-tunnel/frp-token`（`kind: api-key`）。不写入配置、不导出、不写日志、界面不回显。 |
| 界面显示 | 只显示**是否已保存**与**字符长度**。长度明显不对（如 8 个字符）会给出黄色提醒——这通常意味着粘贴时漏了后半段。 |
| 从哪里取 | 服务器上 `grep -i 'auth.token' data/frps/frps.toml`；服务器是别人搭的就向他要。详见 [SETUP-GUIDE.md §2](SETUP-GUIDE.md#2-填frp-密钥)。 |
| 轮换 | 服务器生成新值 → 改 `frps.toml` → `docker compose restart frps` → 本页重新保存密钥 → 「重启隧道」。隧道会短暂中断。 |

frps 侧对应的配置长这样（**这是服务器上的文件，不在本机**）：

```toml
bindPort = 7000
allowPorts = [ { single = 19098 } ]
auth.method = "token"
auth.token = "<随机 >32 字符，例如 openssl rand -hex 32 的输出>"
transport.tls.force = true
```

---

## 3. 信任补丁实际写入什么

「应用」按钮写入的是**本 profile 补丁层**里 `connection` 这一行：

```yaml
- id: connection
  name: '@deepseek-ai/dsh-client-connection'
  config:
    trustedHosts: ['dsh.example.com', 'cli.example.internal']
    cookieMaxAgeDays: 3650
```

**这一行的 `config` 是整行替换**，所以插件会把 `trustedHosts` 一并重写（含启动参数里的 `--trusted-host`），否则只写 `cookieMaxAgeDays` 会让公网 Host 失信。「恢复默认」把这一行整行删掉，回到出厂表达式。

---

## 4. 本地数据与凭据

| 项 | 位置 | 说明 |
|---|---|---|
| 数据目录 | 默认 `$DSH_HOME\dsh-tunnel`（`C:\Users\<你>\.dsh\dsh-tunnel`） | 存放生成的 `frpc.toml`、`logs\frpc.log`、`state.json` |
| `frpc.exe` 托管位置 | `$DSH_HOME\dsh-tunnel\bin\frpc.exe` | 想零配置就用这个位置；杀毒软件请把该**目录**加入信任区 |
| frp token | DSH 凭据存储，键 `dsh-tunnel/frp-token` | 不写入配置、不导出、不写日志、界面不回显 |
| DSH 访问密钥 | 不落盘 | 属于当前 DSH 进程，每次重启都变；点「显示访问密钥」时现取现用 |

---

## 5. 推荐的一份完整配置

| 设置页里的名字 | 建议值 |
|---|---|
| frp 服务器地址 | `vps.example.com` |
| frp 控制端口 | `7000` |
| 公网地址（手机填写） | `https://dsh.example.com` |
| 服务器内部代理端口 | `19098` |
| 代理名 | `dsh-desktop` |
| 本机目标地址 | `127.0.0.1` |
| frp 版本 | `0.71.1` |
| frpc 路径 | （留空，使用托管目录） |
| TLS ServerName | （留空） |
| 登录 Cookie 有效期 | `3650` |
| 额外受信 Host | （留空） |
| 配置格式 | `toml (v0.52+)` |
| 随 DSH 自动启动隧道 | 验证成功后再勾 |
| 启用传送 TLS | ✅ |
| 自动写入 DSH 信任配置 | ✅ |

插件生成的 frpc 配置（不要手改）：

```toml
serverAddr = "vps.example.com"
serverPort = 7000
loginFailExit = false

auth.method = "token"
auth.token = "…"

transport.tls.enable = true

[[proxies]]
name = "dsh-desktop"
type = "tcp"
localIP = "127.0.0.1"
localPort = <DSH 本次实际端口>
remotePort = 19098
```

---

## 6. 自检命令

```powershell
# 1) 二进制在跑、版本正确
& "$env:USERPROFILE\.dsh\dsh-tunnel\bin\frpc.exe" -v

# 2) 插件生成的配置语法是否正确（路径见页面「生成的配置」）
& "$env:USERPROFILE\.dsh\dsh-tunnel\bin\frpc.exe" verify -c "$env:USERPROFILE\.dsh\dsh-tunnel\frpc.toml"

# 3) 控制端口是否可达（本机到服务器）
Test-NetConnection vps.example.com -Port 7000
```

> `verify` 只校验语法，不校验 token/端口策略；那两项只能靠真实登录看日志。

---

## 7. 失败信息对照表

| 日志/状态 | 含义 | 处理 |
|---|---|---|
| `frpc binary not found` | 托管目录和 PATH 都没有 frpc | 放到 `$DSH_HOME\dsh-tunnel\bin\frpc.exe`，或填 `frpcPath` |
| `frpc could not be started: antivirus … blocked it` | 杀软在扫描新写入的 exe | 把数据目录加入信任区，再点「重启隧道」 |
| `frps rejected the login: the frp token does not match` | 两边 token 不一致 | 重新取/重新保存密钥（见 §2） |
| `TLS handshake failed` | TLS 设置不一致 | 勾选「启用传送 TLS」，必要时填 TLS ServerName |
| 登录成功但没有 `start proxy success` | `remotePort` 不在 `allowPorts` 里 | 改 `remotePort` 或改服务器 |
| `frpc version mismatch` | 两端版本不同 | 换成与 frps 同版本的 frpc |
| 状态「需要重启 DSH」 | 信任补丁已写但当前进程未加载 | 重启 DSH |

---

## 8. 相关文档

- [SETUP-GUIDE.md](SETUP-GUIDE.md)：按界面一步步配置的教程
- [SECURITY.md](SECURITY.md)：威胁模型、凭据处理、残余风险
- [README](../README.md)：安装、迁移、卸载
- [DETAIL.md](DETAIL.md)：插件详情页
