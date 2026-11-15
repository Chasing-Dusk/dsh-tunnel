/**
 * The control page served at `/dsh-tunnel/`.
 *
 * It is one self-contained document on the DSH origin, so it inherits the
 * browser's existing authenticated session: no extra portal, no separate
 * password, no build step. All dynamic text is inserted with `textContent`,
 * never as HTML.
 */

/** The page's own stylesheet, kept small and theme-neutral. */
const STYLES = `
:root { color-scheme: light dark; --fg:#1b1f24; --dim:#5c6672; --bg:#f7f8fa; --card:#fff; --line:#dde1e7; --accent:#2f6fed; --ok:#1f9254; --warn:#b26a00; --bad:#c0392b; }
@media (prefers-color-scheme: dark) { :root { --fg:#e6e8eb; --dim:#9aa4b0; --bg:#14171a; --card:#1c2024; --line:#2b3138; --accent:#6ea8fe; --ok:#4ec98a; --warn:#e0a33a; --bad:#f0776a; } }
* { box-sizing: border-box; }
body { margin:0; padding:24px; font:14px/1.6 system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif; background:var(--bg); color:var(--fg); }
main { max-width: 940px; margin: 0 auto; display:flex; flex-direction:column; gap:18px; }
h1 { font-size:20px; margin:0; display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
h2 { font-size:15px; margin:0 0 12px; }
p { margin:0 0 10px; }
.muted { color:var(--dim); }
.small { font-size:12px; }
.card { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:18px; }
.row { display:flex; gap:10px; flex-wrap:wrap; align-items:center; }
.spread { display:flex; justify-content:space-between; gap:12px; flex-wrap:wrap; align-items:center; }
.badge { display:inline-flex; align-items:center; gap:6px; padding:2px 10px; border-radius:999px; border:1px solid var(--line); font-size:12px; }
.badge.ok { color:var(--ok); border-color:currentColor; }
.badge.warn { color:var(--warn); border-color:currentColor; }
.badge.bad { color:var(--bad); border-color:currentColor; }
.grid { display:grid; grid-template-columns: repeat(auto-fit, minmax(260px,1fr)); gap:12px 18px; }
label { display:flex; flex-direction:column; gap:4px; font-size:12px; color:var(--dim); }
label.check { flex-direction:row; align-items:center; gap:8px; font-size:13px; color:var(--fg); }
input[type=text], input[type=number], input[type=password], select { font:inherit; padding:7px 9px; border-radius:8px; border:1px solid var(--line); background:transparent; color:var(--fg); width:100%; }
button { font:inherit; padding:7px 14px; border-radius:8px; border:1px solid var(--line); background:transparent; color:var(--fg); cursor:pointer; }
button:hover { border-color:var(--accent); }
button.primary { background:var(--accent); border-color:var(--accent); color:#fff; }
button.danger { color:var(--bad); border-color:currentColor; }
button:disabled { opacity:.5; cursor:not-allowed; }
code, .mono { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size:12px; }
pre { margin:0; padding:12px; background:rgba(127,127,127,.08); border-radius:8px; overflow:auto; max-height:280px; white-space:pre-wrap; word-break:break-all; }
dl.kv { display:grid; grid-template-columns: max-content 1fr; gap:6px 16px; margin:0; }
dl.kv dt { color:var(--dim); font-size:12px; }
dl.kv dd { margin:0; word-break:break-all; }
.toast { position:fixed; left:50%; bottom:26px; transform:translateX(-50%); padding:10px 18px; border-radius:10px; background:var(--fg); color:var(--bg); opacity:0; transition:opacity .2s; pointer-events:none; max-width:80vw; }
.toast.show { opacity:.95; }
.toast.bad { background:var(--bad); color:#fff; }
hr { border:none; border-top:1px solid var(--line); margin:14px 0; }
`

/** The page's script. Kept inline because the page must work with no build. */
const SCRIPT = `
const API = '/dsh-tunnel/api';
const $ = (id) => document.getElementById(id);
let STATUS = null;

function toast(message, bad) {
  const node = $('toast');
  node.textContent = message;
  node.className = 'toast show' + (bad ? ' bad' : '');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { node.className = 'toast'; }, 4200);
}

async function call(path, body) {
  const init = { method: body === undefined ? 'GET' : 'POST', headers: { 'x-dsh-tunnel': '1' }, cache: 'no-store' };
  if (body !== undefined) { init.headers['content-type'] = 'application/json'; init.body = JSON.stringify(body); }
  const response = await fetch(API + path, init);
  const text = await response.text();
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { throw new Error(text || ('HTTP ' + response.status)); }
  if (!response.ok) throw new Error((parsed && (parsed.error || parsed.message)) || ('HTTP ' + response.status));
  return parsed;
}

async function refresh() {
  try {
    STATUS = await call('/status');
    render();
  } catch (error) {
    $('loadError').textContent = String(error.message || error);
    $('loadError').hidden = false;
  }
}

function text(node, value) { node.textContent = value === undefined || value === null ? '' : String(value); }
function badge(node, label, tone) { node.textContent = label; node.className = 'badge ' + (tone || ''); }
function setIf(id, value) { const node = $(id); if (node && node.type !== 'password') node.value = value ?? ''; }
function setCheck(id, value) { const node = $(id); if (node) node.checked = Boolean(value); }

const STATE_LABEL = {
  running: ['运行中', 'ok'], connected: ['已连接', 'ok'], starting: ['启动中', 'warn'], backoff: ['重试中', 'warn'],
  stopped: ['已停止', ''], idle: ['未启动', ''], error: ['出错', 'bad'], 'missing-binary': ['缺少 frpc', 'bad'],
  'invalid-config': ['配置不完整', 'bad'],
};

function render() {
  const s = STATUS;
  if (!s) return;
  const runtime = s.tunnel.runtime;
  const tone = runtime.proxyStarted ? 'ok' : runtime.connected ? 'warn' : runtime.state === 'running' ? 'warn' : (STATE_LABEL[runtime.state] || ['',''])[1];
  const key = runtime.proxyStarted ? 'connected' : runtime.state;
  const label = (STATE_LABEL[key] || [key, ''])[0];
  badge($('stateBadge'), label, tone);
  text($('origin'), s.dsh.origin || '未绑定');
  text($('publicUrlLine'), s.tunnel.publicUrl || '未配置');
  text($('frpcVersion'), runtime.frpcVersion || '未知');
  text($('localPort'), runtime.localPort || '—');
  text($('binaryPath'), runtime.binaryPath || '未找到');
  text($('configPath'), runtime.configPath || '—');
  text($('lastError'), runtime.lastError || '无');
  text($('trustState'), s.trust.effective ? '已生效' : '未生效');
  badge($('trustBadge'), s.trust.effective ? '公网 Host 已受信' : '需要重启 DSH', s.trust.effective ? 'ok' : 'warn');
  text($('trustHosts'), (s.trust.trustedHosts || []).join(', ') || '（未写入）');
  text($('pending'), s.trust.pendingRestart ? '改动尚未生效：重启 DSH 后才会接受公网 Host。' : '');
  $('pending').hidden = !s.trust.pendingRestart;
  text($('harmony'), s.harmony.installed ? (s.harmony.version + (s.harmony.enabled ? ' · 已启用' : ' · 未启用')) : '未安装');
  $('harmonyAdvice').hidden = !s.harmony.advice;
  text($('harmonyAdvice'), s.harmony.advice || '');

  const form = s.config;
  for (const [key, value] of Object.entries(form)) {
    const node = $(key);
    if (!node) continue;
    if (node.type === 'checkbox') node.checked = Boolean(value);
    else if (node.id === 'trustedHosts') node.value = Array.isArray(value) ? value.join(', ') : '';
    else node.value = value ?? '';
  }
  const token = s.token;
  text($('tokenState'), token.configured ? '已保存（不会显示）' : '未设置');
  badge($('tokenBadge'), token.configured ? '密钥已就绪' : '缺少密钥', token.configured ? 'ok' : 'warn');

  text($('startupPath'), s.startup.path || '本平台不支持');
  text($('startupState'), s.startup.exists ? '已存在' : '未创建');
  $('startupCreate').disabled = !s.startup.supported;
  $('startupRemove').hidden = !s.startup.exists;

  text($('logTail'), (s.logs || []).join('\\n') || '（暂无日志）');
  $('startBtn').disabled = runtime.state === 'running';
  $('stopBtn').disabled = runtime.state === 'stopped';
  text($('loginUrl'), s.login.url || '未配置公网地址');
}

async function saveConfig(event) {
  event.preventDefault();
  const payload = {};
  for (const key of ['serverAddr','serverPort','remotePort','publicUrl','localHost','proxyName','frpcPath','frpVersion','frpConfigFormat','tlsServerName','cookieMaxAgeDays']) {
    const node = $(key); if (node) payload[key] = node.type === 'number' ? Number(node.value) : node.value;
  }
  for (const key of ['enabled','tls','autoApplyTrust']) {
    const node = $(key); if (node) payload[key] = node.checked;
  }
  const hosts = $('trustedHosts').value.split(/[,\\n]/).map((x) => x.trim()).filter(Boolean);
  payload.trustedHosts = hosts;
  // Saving restarts this plugin, which can cut this very response. Treat a
  // transport error as "unknown", then read the live state back instead of
  // claiming the save failed when it actually took effect.
  let error = null;
  try { await call('/config', payload); } catch (caught) { error = caught; }
  const applied = await waitForReload();
  if (!applied) toast('保存后未能确认生效，请刷新页面检查' + (error ? '：' + error.message : ''), true);
}

async function waitForReload() {
  for (let i = 0; i < 30; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 700));
    try {
      await refresh();
      toast('已保存并生效');
      return true;
    } catch (error) { /* still reloading */ }
  }
  return false;
}

async function saveToken(event) {
  event.preventDefault();
  const value = $('tokenInput').value;
  if (!value) { toast('请输入 frp token', true); return; }
  try { await call('/token', { token: value }); $('tokenInput').value = ''; toast('密钥已保存'); await refresh(); }
  catch (error) { toast('保存失败：' + error.message, true); }
}

async function action(path, body, message) {
  try { await call(path, body ?? {}); toast(message); await refresh(); }
  catch (error) { toast('操作失败：' + error.message, true); }
}

async function revealLogin() {
  try {
    const info = await call('/login-info', {});
    text($('loginUrl'), info.url || '未配置公网地址');
    text($('accessKey'), info.accessKey || '不可用');
    $('revealBtn').hidden = true;
    $('copyBtn').hidden = false;
    toast('访问密钥仅对当前 DSH 进程有效，请勿截图外发');
  } catch (error) { toast('读取失败：' + error.message, true); }
}

async function copyKey() {
  const value = $('accessKey').textContent || '';
  try { await navigator.clipboard.writeText(value); toast('已复制'); }
  catch { toast('复制失败，请手动选择', true); }
}

async function exportConfig() {
  try {
    const document_ = await call('/export');
    const blob = new Blob([JSON.stringify(document_, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'dsh-tunnel-config.json';
    link.click();
    URL.revokeObjectURL(link.href);
    toast('已导出（不含任何密钥）');
  } catch (error) { toast('导出失败：' + error.message, true); }
}

async function importConfig(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    const outcome = await call('/import', { document: parsed });
    toast(outcome.warnings && outcome.warnings.length ? '已导入：' + outcome.warnings.join('; ') : '已导入');
    await refresh();
  } catch (error) { toast('导入失败：' + error.message, true); }
  finally { event.target.value = ''; }
}

$('configForm').addEventListener('submit', saveConfig);
$('tokenForm').addEventListener('submit', saveToken);
$('refreshBtn').addEventListener('click', refresh);
$('startBtn').addEventListener('click', () => action('/start', {}, '已请求启动'));
$('stopBtn').addEventListener('click', () => action('/stop', {}, '已请求停止'));
$('restartBtn').addEventListener('click', () => action('/restart', {}, '已请求重启'));
$('applyTrust').addEventListener('click', () => action('/trust/apply', {}, '信任配置已写入；如提示需要重启请重启 DSH'));
$('revertTrust').addEventListener('click', () => action('/trust/revert', {}, '已恢复 DSH 默认信任配置'));
$('startupCreate').addEventListener('click', () => action('/startup/create', {}, '启动项已创建'));
$('startupRemove').addEventListener('click', () => action('/startup/remove', {}, '启动项已移除'));
$('exportBtn').addEventListener('click', exportConfig);
$('importInput').addEventListener('change', importConfig);
$('revealBtn').addEventListener('click', revealLogin);
$('copyBtn').addEventListener('click', copyKey);

refresh();
setInterval(() => { if (!document.hidden) refresh().catch(() => {}); }, 5000);
`

/**
 * Renders the control page.
 * @param {{version: string, pluginId: string}} options - plugin identity.
 * @returns {string} a complete HTML document.
 */
export function renderPage({ version = '', pluginId = 'dsh-tunnel' } = {}) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>DSH 公网隧道 · dsh-tunnel</title>
<style>${STYLES}</style>
</head>
<body>
<main>
  <h1>DSH 公网隧道 <span class="badge" id="stateBadge">加载中</span> <span class="muted small mono">${escapeHtml(pluginId)} ${escapeHtml(version)}</span></h1>
  <p class="muted small">把本机的 DSH 通过 frp 隧道发布到一个固定公网地址，让手机用「服务地址 + 访问密钥」登录一次后长期使用。此页面只在本机 DSH 进程中打开，所有密钥都不会离开这台电脑。</p>
  <div class="card" id="loadError" hidden></div>

  <section class="card">
    <div class="spread"><h2>状态</h2><div class="row"><button id="refreshBtn">刷新</button><button id="startBtn">启动</button><button id="stopBtn">停止</button><button id="restartBtn">重启隧道</button></div></div>
    <dl class="kv">
      <dt>DSH 监听</dt><dd class="mono" id="origin"></dd>
      <dt>公网地址</dt><dd class="mono" id="publicUrlLine"></dd>
      <dt>本机端口</dt><dd class="mono" id="localPort"></dd>
      <dt>frpc 版本</dt><dd class="mono" id="frpcVersion"></dd>
      <dt>frpc 路径</dt><dd class="mono" id="binaryPath"></dd>
      <dt>生成的配置</dt><dd class="mono" id="configPath"></dd>
      <dt>最近错误</dt><dd class="mono" id="lastError"></dd>
    </dl>
    <hr>
    <h2>frpc 日志（已脱敏）</h2>
    <pre class="mono" id="logTail"></pre>
  </section>

  <section class="card">
    <h2>隧道参数</h2>
    <form id="configForm">
      <div class="grid">
        <label>frp 服务器地址<input type="text" id="serverAddr" autocomplete="off" placeholder="vps.example.com"></label>
        <label>frp 控制端口<input type="number" id="serverPort" min="1" max="65535"></label>
        <label>公网地址（手机填写）<input type="text" id="publicUrl" autocomplete="off" placeholder="https://dsh.example.com"></label>
        <label>服务器内部代理端口<input type="number" id="remotePort" min="1" max="65535"></label>
        <label>代理名（每台机器唯一）<input type="text" id="proxyName" autocomplete="off"></label>
        <label>本机目标地址<input type="text" id="localHost" autocomplete="off"></label>
        <label>frp 版本（与服务器一致）<input type="text" id="frpVersion" autocomplete="off" placeholder="0.61.1"></label>
        <label>配置格式<select id="frpConfigFormat"><option value="toml">toml（v0.52+）</option><option value="ini">ini（旧版）</option></select></label>
        <label>frpc 路径（留空自动查找）<input type="text" id="frpcPath" autocomplete="off"></label>
        <label>TLS ServerName（可选）<input type="text" id="tlsServerName" autocomplete="off"></label>
        <label>额外受信 Host（逗号分隔）<input type="text" id="trustedHosts" autocomplete="off" placeholder="192.168.1.20:3080"></label>
        <label>登录 Cookie 有效期（天）<input type="number" id="cookieMaxAgeDays" min="1" max="36500"></label>
      </div>
      <div class="row" style="margin-top:12px">
        <label class="check"><input type="checkbox" id="enabled"> 随 DSH 自动启动隧道</label>
        <label class="check"><input type="checkbox" id="tls"> 启用传送 TLS</label>
        <label class="check"><input type="checkbox" id="autoApplyTrust"> 自动写入 DSH 信任配置</label>
      </div>
      <div class="row" style="margin-top:14px"><button class="primary" type="submit">保存设置</button><span class="muted small">保存会重新加载插件并重建 frpc 配置。</span></div>
    </form>
  </section>

  <section class="card">
    <h2>frp 密钥 <span class="badge" id="tokenBadge"></span></h2>
    <p class="muted small">密钥保存在 DSH 凭据存储中，不写入插件配置、不导出、不显示、不写日志。当前：<span id="tokenState"></span></p>
    <form id="tokenForm" class="row">
      <input type="password" id="tokenInput" autocomplete="new-password" placeholder="粘贴 frp token 后保存" style="max-width:420px">
      <button class="primary" type="submit">保存密钥</button>
      <button type="button" class="danger" onclick="call('/token',{token:''}).then(()=>refresh()).then(()=>toast('已清除密钥')).catch((e)=>toast('清除失败：'+e.message,true))">清除密钥</button>
    </form>
  </section>

  <section class="card">
    <div class="spread"><h2>DSH 信任配置 <span class="badge" id="trustBadge"></span></h2><div class="row"><button id="applyTrust">应用</button><button id="revertTrust" class="danger">恢复默认</button></div></div>
    <dl class="kv">
      <dt>当前进程</dt><dd id="trustState"></dd>
      <dt>受信 Host</dt><dd class="mono" id="trustHosts"></dd>
    </dl>
    <p class="muted small" style="margin-top:10px">DSH 只接受回环地址、监听地址或 <code>trustedHosts</code> 中的 Host。这里会写入 profile 的 <code>cordis.patch.yml</code>，并同时保留原有的启动参数 Host，避免覆盖后公网地址失信。</p>
    <p class="badge warn" id="pending" hidden></p>
  </section>

  <section class="card">
    <h2>手机登录</h2>
    <p class="muted small">手机 App 里填同一个服务地址，登录方式选「访问密钥」，密钥填下面的值。密钥只对<b>当前 DSH 进程</b>有效，DSH 重启后会变；泄露等于把整台电脑的控制权交出去，不要截图、不要发群。</p>
    <dl class="kv">
      <dt>服务地址</dt><dd class="mono" id="loginUrl"></dd>
      <dt>访问密钥</dt><dd class="mono" id="accessKey">（默认隐藏）</dd>
    </dl>
    <div class="row" style="margin-top:10px"><button id="revealBtn">显示访问密钥</button><button id="copyBtn" hidden>复制</button></div>
  </section>

  <section class="card">
    <h2>开机自启（Windows 登录后恢复）</h2>
    <p class="muted small">非管理员环境无法注册服务；唯一的路径是在当前用户的「启动」文件夹放一个快捷方式。只有你点击后才会创建，卸载时会被移除。</p>
    <dl class="kv"><dt>快捷方式</dt><dd class="mono" id="startupPath"></dd><dt>状态</dt><dd id="startupState"></dd></dl>
    <div class="row" style="margin-top:10px"><button id="startupCreate">创建启动项</button><button id="startupRemove" class="danger">移除启动项</button></div>
  </section>

  <section class="card">
    <h2>迁移（换电脑 / 换服务器）</h2>
    <p class="muted small">导出的 JSON 只有地址和端口，不含任何密钥，也不含本机路径。换机时：装 DSH → 装插件 → 导入 → 填密钥 → 应用信任 → 重启 DSH。</p>
    <div class="row"><button id="exportBtn">导出配置</button><label class="check" style="cursor:pointer"><input type="file" id="importInput" accept="application/json" style="width:auto"> 导入配置</label></div>
  </section>

  <section class="card">
    <h2>依赖检查</h2>
    <dl class="kv"><dt>@dsh-harmony/plugin</dt><dd id="harmony"></dd></dl>
    <p class="badge warn" id="harmonyAdvice" hidden></p>
  </section>

  <section class="card">
    <h2>卸载与拆除</h2>
    <p class="muted small">顺序：停用隧道 → 移除启动项 → 恢复默认信任配置 → 在插件页移除 dsh-tunnel → 清理 <code>$DSH_HOME/dsh-tunnel</code> 与 DSH 凭据中的 <code>dsh-tunnel/frp-token</code>。</p>
  </section>
</main>
<div class="toast" id="toast"></div>
<script>${SCRIPT}</script>
</body>
</html>
`
}

/** Escapes text for safe inclusion in the static template. */
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char])
}
