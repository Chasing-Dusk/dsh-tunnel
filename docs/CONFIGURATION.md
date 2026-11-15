# 配置项参考 · dsh-tunnel

每一项都写明**取值格式、默认值、可直接抄的示例、以及常见的写错方式**。
所有值都在 DSH 的 **设置 → 公网隧道** 里编辑，保存后写入本 profile 的补丁层，不需要手改文件。

> 三条铁律（90% 的失败都出在这里）
>
> 1. **frp 版本必须与服务器一致**：`frpVersion` ＝ frps 的版本，`frpc` 二进制也必须是同一版本。
> 2. **TLS 必须与 frps 对齐**：服务器写了 `transport.tls.force = true`，这里就必须勾选「启用传送 TLS」。
> 3. **remotePort 必须与 frps 的 `allowPorts` 一致**：服务器只放行某个端口时，这里填别的端口会「登录成功但建隧道失败」。

---

## 1. 隧道参数

| 配置项 | 格式 | 默认 | 示例 | 说明与常见错法 |
|---|---|---|---|---|
| `enabled` | 布尔 | `false` | 勾选 | 是否随 DSH 启动自动拉起隧道。关闭时仍可在页面点「启动」临时运行。 |
| `serverAddr` | 主机名或 IP，**不带协议、不带端口、不带路径** | 空 | `vps.example.com`<br>`8.130.36.4` | 本机可达的 frps 地址。写成 `http://vps.example.com:7000` 会登录失败。 |
| `serverPort` | 整数 1–65535 | `7000` | `7000` | frps 的**控制端口**（`bindPort`），不是你说的公网 443。 |
| `publicUrl` | `http(s)://host[:port]`，**不带路径 / 查询串 / 账号信息** | 空 | `https://dsh.example.com` | 手机里填写的服务地址。它的 host 会被写进 DSH 的 `trustedHosts`。写成 `dsh.example.com`（缺协议）或 `https://x.com/path` 都会被拒绝。 |
| `remotePort` | 整数 1–65535 | `19098` | `19098` | 服务器内部代理端口：frps 暴露给反向代理的端口。必须落在 frps 的 `allowPorts` 里。 |
| `localHost` | 主机名或 IP | `127.0.0.1` | `127.0.0.1` | frpc 转发到本机的地址。DSH 桌面版绑回环，保持默认。 |
| `proxyName` | `[A-Za-z0-9_.-]`，1–64 字符 | `dsh-desktop` | `dsh-desktop`<br>`dsh-office-pc` | frps 上的代理名，**同一服务器内唯一**。两台电脑用同一个名字会互相顶掉。 |
| `frpVersion` | `x.y.z` | 空 | `0.71.1` | 期望的 frp 版本，只用于**比对告警**：插件的 `frpc -v` 与它不一致时会写日志提醒。 |
| `frpConfigFormat` | `toml` / `ini` | `toml` | `toml` | frp **v0.52 及以后用 `toml`**，更早用 `ini`。选错会让 frpc 启动即退出（日志里是语法错误）。 |
| `tls` | 布尔 | `true` | 勾选 | frp 传输层 TLS。frps 写了 `transport.tls.force = true` 时必须勾选。 |
| `tlsServerName` | 主机名 | 空 | `frp.example.com` | 用 IP 连 frps、但希望按服务器证书名做 SNI 时填写；通常留空（用 `serverAddr`）。 |
| `frpcPath` | 绝对路径 | 空 | `D:\tools\frpc.exe` | 留空时按「托管目录 → PATH」自动查找，托管目录是 `$DSH_HOME\dsh-tunnel\bin\frpc.exe`。 |
| `restartBaseDelayMs` | 整数 ≥200 | `2000` | `2000` | 崩溃后首次重启等待（毫秒），之后指数翻倍。 |
| `restartMaxDelayMs` | 整数 ≥1000 | `60000` | `60000` | 重启等待上限。 |

## 2. DSH 信任相关

| 配置项 | 格式 | 默认 | 示例 | 说明 |
|---|---|---|---|---|
| `trustedHosts` | 逗号分隔的 authority（`host` 或 `host:port`，**不带协议**） | 空 | `192.168.1.20:3080, nas.example.com` | 除 `publicUrl` 的 host 之外，额外允许访问 DSH 的地址（例如局域网直连）。填 `https://…` 会被判非法并记录日志。端口省略表示匹配任意端口。 |
| `cookieMaxAgeDays` | 整数 ≥1 | `3650` | `3650` | 登录 Cookie 有效期（天）。DSH 默认 30 天——这就是「多久要回到电脑旁重新取一次密钥」。 |
| `autoApplyTrust` | 布尔 | `true` | 勾选 | 配置了 `publicUrl` 后，插件启动时会自动把信任补丁写回 profile（内容不变则不重复写，避免反复重载连接服务）。 |

「应用」按钮写入的是 profile 补丁层里 `connection` 这一行：

```yaml
- id: connection
  name: '@deepseek-ai/dsh-client-connection'
  config:
    trustedHosts: ['dsh.example.com', 'cli.example.internal']
    cookieMaxAgeDays: 3650
```

注意：**这一行的 `config` 是整行替换**，所以插件会把 `trustedHosts` 一并重写（含启动参数里的 `--trusted-host`），否则只写 `cookieMaxAgeDays` 会让公网 Host 失信。「恢复默认」会把这一行整行删掉，回到出厂表达式。

## 3. 本地数据与凭据

| 项 | 位置 | 说明 |
|---|---|---|
| 数据目录 `dataDir` | 默认 `$DSH_HOME\dsh-tunnel`（即 `C:\Users\<你>\.dsh\dsh-tunnel`） | 存放生成的 `frpc.toml`、`logs\frpc.log`、`state.json`。留空即默认。 |
| `frpc.exe` 托管位置 | `$DSH_HOME\dsh-tunnel\bin\frpc.exe` | 想零配置就用这个位置；杀毒软件请把该**目录**加入信任区。 |
| frp token | DSH 凭据存储，键 `dsh-tunnel:frp-token` | 不写入配置、不导出、不写日志、界面不回显。清除就是删除该记录。 |
| DSH 访问密钥 | 不落盘 | 属于当前 DSH 进程，每次重启都变；只在你点「显示访问密钥」时现取现用。 |

## 4. 推荐的一份完整配置

```
frp 服务器地址        vps.example.com
frp 控制端口          7000
公网地址（手机填写）  https://dsh.example.com
服务器内部代理端口    19098
代理名                dsh-desktop
本机目标地址          127.0.0.1
frp 版本              0.71.1
frpc 路径             （留空，使用托管目录）
TLS ServerName        （留空）
登录 Cookie 有效期    3650
额外受信 Host         （留空，除非需要局域网直连）
配置格式              toml (v0.52+)
✅ 随 DSH 自动启动隧道
✅ 启用传送 TLS
✅ 自动写入 DSH 信任配置
```

对应的 frps 侧应当有：

```toml
bindPort = 7000
allowPorts = [ { single = 19098 } ]
auth.method = "token"
auth.token = "<随机 >32 字符>"
transport.tls.force = true
```

frpc 侧由插件生成（不要手改）：

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

## 5. 自己检查配置是否可用

```powershell
# 1) 二进制在跑、版本正确
& "$env:USERPROFILE\.dsh\dsh-tunnel\bin\frpc.exe" -v

# 2) 插件生成的配置语法是否正确（路径见页面「生成的配置」）
& "$env:USERPROFILE\.dsh\dsh-tunnel\bin\frpc.exe" verify -c "$env:USERPROFILE\.dsh\dsh-tunnel\frpc.toml"

# 3) 控制端口是否可达（本机到服务器）
Test-NetConnection vps.example.com -Port 7000
```

> `verify` 只校验语法，不校验 token/端口策略；那两项只能靠真实登录看日志。

## 6. 失败信息对照表

| 日志/状态 | 含义 | 处理 |
|---|---|---|
| `frpc binary not found` | 托管目录和 PATH 都没有 frpc | 放到 `$DSH_HOME\dsh-tunnel\bin\frpc.exe`，或在 `frpcPath` 指定路径 |
| `frpc could not be started: antivirus … blocked it` | 杀软在扫描新写入的 exe，首次启动被拒 | 把数据目录加入杀软信任区，再点「重启隧道」重试 |
| `frps rejected the login: the frp token does not match` | 两边 token 不一致 | 重新保存 frp token（服务器侧没改过的话） |
| `TLS handshake failed` | 客户端/服务端 TLS 设置不一致 | 勾选「启用传送 TLS」，与 frps 的 `transport.tls.force` 对齐 |
| 登录成功但 `start proxy success` 没有出现 | `remotePort` 不在 `allowPorts` 里 | 改 `remotePort` 或改服务器 `allowPorts` |
| `frpc version mismatch` | 两边版本不同 | 换成与 frps 同版本的 frpc |

## 7. 相关文档

- [README](../README.md)：安装、首次使用、迁移、卸载、安全说明
- [SECURITY.md](SECURITY.md)：威胁模型、凭据处理、残余风险
- [DETAIL.md](DETAIL.md)：插件详情页（Plugin Manager 展示用）
