/**
 * The browser half of dsh-tunnel.
 *
 * It registers three surfaces and never opens a window: the desktop shell
 * denies `window.open` for its own origin, so a "new tab" button quietly did
 * nothing.
 *
 *   1. `settings.section` — the full tunnel page inside DSH Settings.
 *   2. `sidebar.footer.action` — a state dot that opens an in-app overlay.
 *   3. `shell.overlay` — that overlay, rendering the same panel.
 *
 * All data comes from the Host's fenced JSON API; the frp token and the DSH
 * access key are never part of the status payload.
 */
window.__ModuleLoader__.load({
  id: 'dsh-tunnel',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useRef, useCallback } = React

    const NS = 'dsh-tunnel'
    const API = '/dsh-tunnel/api'

    // ── text ────────────────────────────────────────────────────────────────
    const EN = {
      title: 'Public tunnel',
      subtitle: 'Publish this DSH behind a fixed public HTTPS address. Requires your own frp server.',
      refresh: 'Refresh',
      start: 'Start',
      stop: 'Stop',
      restart: 'Restart',
      save: 'Save',
      saving: 'Saving…',
      saved: 'Saved',
      clear: 'Clear',
      cancel: 'Cancel',
      close: 'Close',
      apply: 'Apply',
      revert: 'Restore defaults',
      reveal: 'Show access key',
      copy: 'Copy',
      copied: 'Copied',
      export: 'Copy config JSON',
      importLabel: 'Import config',
      create: 'Create startup entry',
      remove: 'Remove startup entry',
      unknown: 'unknown',
      none: 'none',
      notSet: 'not set',
      status: 'Status',
      settings: 'Tunnel settings',
      secret: 'frp token',
      trust: 'DSH trust',
      login: 'Phone login',
      startup: 'Start automatically',
      migration: 'Move to another computer',
      deps: 'Dependencies',
      logs: 'frpc log (redacted)',
      showLogs: 'Show log',
      hideLogs: 'Hide log',
      field: {
        serverAddr: 'frp server address',
        serverPort: 'frp control port',
        publicUrl: 'Public address (typed on the phone)',
        remotePort: 'Server proxy port',
        proxyName: 'Proxy name (unique per machine)',
        localHost: 'Local target address',
        frpVersion: 'frp version (match the server)',
        frpConfigFormat: 'Config format',
        frpcPath: 'frpc path (empty = auto-detect)',
        tlsServerName: 'TLS ServerName (optional)',
        trustedHosts: 'Extra trusted hosts (comma separated)',
        cookieMaxAgeDays: 'Login cookie lifetime (days)',
      },
      check: {
        enabled: 'Start the tunnel with DSH',
        tls: 'Encrypt the frpc connection',
        autoApplyTrust: 'Write the DSH trust patch automatically',
      },
      lbl: {
        dsh: 'DSH listening on',
        publicUrl: 'Public address',
        localPort: 'Local port',
        frpcVersion: 'frpc version',
        frpcPath: 'frpc path',
        lastError: 'Last error',
      },
      hint: {
        status: 'The frpc configuration is rebuilt from the port DSH actually bound, on every start.',
        settings: 'Saving restarts this plugin and rebuilds the frpc configuration.',
        secret: 'Stored in the DSH credential store. Never exported, never logged, never shown again.',
        trust: 'DSH only accepts loopback, its bind address, or listed authorities. Writing this restates the launch-argument hosts so they are not dropped.',
        login: 'The access key is valid for the current DSH process only and grants full control of this computer. Do not screenshot or share it.',
        startup: 'Without administrator rights the only recovery path is a shortcut in this user\'s Startup folder. It is created only when you ask.',
        migration: 'The JSON holds addresses and ports only: no token, no access key, no local path.',
        deps: 'The phone protocol is provided by the official DSH-Harmony plugin; this plugin only makes the machine reachable.',
        logs: 'Tokens and URL query strings are replaced before anything is stored or shown.',
      },
      state: {
        running: 'running',
        connected: 'connected',
        starting: 'starting',
        backoff: 'retrying',
        stopped: 'stopped',
        idle: 'not started',
        error: 'error',
        'missing-binary': 'frpc missing',
        'invalid-config': 'incomplete',
        stoppedByUser: 'stopped by you',
      },
      token: { configured: 'saved', missing: 'missing' },
      trustState: { live: 'applied and live', pending: 'restart DSH to apply', none: 'not applied' },
      loginPlaceholder: 'Set the public address first',
      accessKey: 'Access key',
      loginUnconfigured: 'No public address is configured yet, so this key only unlocks this machine. It belongs to the running DSH process and changes every time DSH starts.',
      hidden: 'hidden',
      keyPresent: 'Press "Show access key" to reveal it.',
      frpcMissing: 'Put frpc(.exe) in the plugin data directory, or set an explicit path.',
      emptyLog: 'No output yet.',
      uiError: 'The tunnel control UI failed to render',
    }

    const ZH = {
      title: '公网隧道',
      subtitle: '把本机 DSH 发布到一个固定公网 HTTPS 地址。需要自备 frp 服务器。',
      refresh: '刷新',
      start: '启动',
      stop: '停止',
      restart: '重启隧道',
      save: '保存',
      saving: '保存中…',
      saved: '已保存',
      clear: '清除',
      cancel: '取消',
      close: '关闭',
      apply: '应用',
      revert: '恢复默认',
      reveal: '显示访问密钥',
      copy: '复制',
      copied: '已复制',
      export: '复制配置 JSON',
      importLabel: '导入配置',
      create: '创建启动项',
      remove: '移除启动项',
      unknown: '未知',
      none: '无',
      notSet: '未设置',
      status: '状态',
      settings: '隧道参数',
      secret: 'frp 密钥',
      trust: 'DSH 信任配置',
      login: '手机登录',
      startup: '开机自启',
      migration: '迁移到另一台电脑',
      deps: '依赖检查',
      logs: 'frpc 日志（已脱敏）',
      showLogs: '展开日志',
      hideLogs: '收起日志',
      field: {
        serverAddr: 'frp 服务器地址',
        serverPort: 'frp 控制端口',
        publicUrl: '公网地址（手机填写）',
        remotePort: '服务器内部代理端口',
        proxyName: '代理名（每台机器唯一）',
        localHost: '本机目标地址',
        frpVersion: 'frp 版本（与服务器一致）',
        frpConfigFormat: '配置格式',
        frpcPath: 'frpc 路径（留空自动查找）',
        tlsServerName: 'TLS ServerName（可选）',
        trustedHosts: '额外受信 Host（逗号分隔）',
        cookieMaxAgeDays: '登录 Cookie 有效期（天）',
      },
      check: {
        enabled: '随 DSH 自动启动隧道',
        tls: '启用传送 TLS',
        autoApplyTrust: '自动写入 DSH 信任配置',
      },
      lbl: {
        dsh: 'DSH 监听',
        publicUrl: '公网地址',
        localPort: '本机端口',
        frpcVersion: 'frpc 版本',
        frpcPath: 'frpc 路径',
        lastError: '最近错误',
      },
      hint: {
        status: '每次启动都会按 DSH 实际监听的端口重新生成 frpc 配置。',
        settings: '保存会重新加载插件并重建 frpc 配置。',
        secret: '只保存在 DSH 凭据存储中：不导出、不写日志、不会再次显示。',
        trust: 'DSH 只接受回环地址、监听地址或列表中的 Host。这里写入时会连同启动参数里的 Host 一起写回，避免被覆盖后公网地址失信。',
        login: '访问密钥只对当前 DSH 进程有效，泄露等于整台电脑的控制权。不要截图、不要发送。',
        startup: '非管理员环境唯一的恢复路径是在当前用户的「启动」文件夹放一个快捷方式，只有你点击时才会创建。',
        migration: '导出的 JSON 只有地址与端口：不含密钥、不含访问密钥、不含本机路径。',
        deps: '手机协议由官方 DSH-Harmony 插件提供，本插件只负责让这台机器可达且受信。',
        logs: '所有输出在写入磁盘或显示之前都会替换掉 token 与 URL 查询串。',
      },
      state: {
        running: '运行中',
        connected: '已连接',
        starting: '启动中',
        backoff: '重试中',
        stopped: '已停止',
        idle: '未启动',
        error: '出错',
        'missing-binary': '缺少 frpc',
        'invalid-config': '配置不完整',
        stoppedByUser: '已被你停止',
      },
      token: { configured: '已保存', missing: '未设置' },
      trustState: { live: '已生效', pending: '需要重启 DSH', none: '未写入' },
      loginPlaceholder: '请先设置公网地址',
      accessKey: '访问密钥',
      loginUnconfigured: '尚未配置公网地址，这串密钥目前只能用于本机访问。它属于当前运行中的 DSH 进程，每次 DSH 重启都会变。',
      hidden: '已隐藏',
      keyPresent: '点「显示访问密钥」查看。',
      frpcMissing: '请把 frpc(.exe) 放到插件数据目录，或填写明确路径。',
      emptyLog: '暂无输出。',
      uiError: '隧道控制界面渲染失败',
    }

    /** Flattens the readable nested dictionaries into the flat locale shape. */
    function flatten(source, prefix = '', out = {}) {
      for (const [key, value] of Object.entries(source)) {
        const path = prefix === '' ? key : `${prefix}.${key}`
        if (value !== null && typeof value === 'object' && !Array.isArray(value)) flatten(value, path, out)
        else out[path] = String(value)
      }
      return out
    }

    /** Builds a translator, preferring the shell's locale service. */
    function makeTranslate(ctx) {
      const flat = { en: flatten(EN), zh: flatten(ZH) }
      let bound = null
      let active = ''
      try {
        const locale = ctx.get?.('locale')
        active = String(locale?.getLocale?.()?.active ?? locale?.getSnapshot?.()?.active ?? '')
        if (typeof locale?.register === 'function') {
          locale.register(NS, 'en', flat.en)
          locale.register(NS, 'zh', flat.zh)
        }
        if (typeof locale?.bind === 'function') bound = locale.bind(NS)
      } catch {
        // The panel stays usable without the locale service.
      }
      const browser = String((typeof navigator !== 'undefined' && navigator.language) || '')
      const zh = (active || browser).toLowerCase().startsWith('zh')
      const words = zh ? flat.zh : flat.en
      return (key, vars) => {
        if (bound !== null) {
          try {
            const value = bound(key, vars)
            if (typeof value === 'string' && value !== key) return value
          } catch {
            // fall through to the local dictionary
          }
        }
        const raw = words[key] ?? flat.en[key] ?? key
        if (!vars) return raw
        return String(raw).replace(/\{(\w+)\}/g, (match, name) => (name in vars ? String(vars[name]) : match))
      }
    }

    /** One request against the plugin's own API. */
    async function api(path, body) {
      const init = { method: body === undefined ? 'GET' : 'POST', headers: { 'x-dsh-tunnel': '1' }, cache: 'no-store' }
      if (body !== undefined) {
        init.headers['content-type'] = 'application/json'
        init.body = JSON.stringify(body)
      }
      const response = await fetch(API + path, init)
      const text = await response.text()
      let parsed = null
      try {
        parsed = text === '' ? null : JSON.parse(text)
      } catch {
        throw new Error(text || `HTTP ${response.status}`)
      }
      if (!response.ok) throw new Error((parsed && parsed.error) || `HTTP ${response.status}`)
      return parsed
    }

    // ── shared overlay state (two slots, one panel) ──────────────────────────
    let overlayOpen = false
    const overlayListeners = new Set()
    function setOverlay(next) {
      overlayOpen = next
      for (const listener of overlayListeners) listener()
    }
    function useOverlayOpen() {
      const [, bump] = useState(0)
      useEffect(() => {
        const listener = () => bump((value) => value + 1)
        overlayListeners.add(listener)
        return () => overlayListeners.delete(listener)
      }, [])
      return overlayOpen
    }

    /** Polls the tunnel status while the surface is visible. */
    function useStatus(active) {
      const [state, setState] = useState({ status: null, error: '', loading: true })
      const alive = useRef(true)
      const load = useCallback(async () => {
        try {
          const status = await api('/status')
          if (alive.current) setState({ status, error: '', loading: false })
        } catch (error) {
          if (alive.current) setState((prev) => ({ status: prev.status, error: String(error.message || error), loading: false }))
        }
      }, [])
      useEffect(() => {
        alive.current = true
        if (!active) return () => { alive.current = false }
        void load()
        const timer = window.setInterval(() => {
          if (!document.hidden) void load()
        }, 5000)
        return () => {
          alive.current = false
          window.clearInterval(timer)
        }
      }, [active, load])
      return { ...state, reload: load, patch: setState }
    }

    const token = (name, fallback) => `var(${name}, ${fallback})`
    const COLORS = {
      text: token('--dsw-alias-label-primary', '#1b1f24'),
      dim: token('--dsw-alias-label-secondary', '#5c6672'),
      line: token('--dsw-alias-border-l1', '#dde1e7'),
      lineStrong: token('--dsw-alias-border-l2', '#c7ccd4'),
      surface: token('--dsw-alias-bg-layer-1', '#ffffff'),
      nested: token('--dsw-alias-bg-layer-2', '#f4f5f7'),
      overlay: token('--dsw-alias-bg-overlay', '#ffffff'),
      brand: token('--dsw-alias-brand-primary', '#2f6fed'),
      ok: token('--dsw-alias-state-success-primary', '#1f9254'),
      warn: token('--dsw-alias-state-warn-primary', '#b26a00'),
      bad: token('--dsw-alias-state-error-primary', '#c0392b'),
      idle: token('--dsw-alias-state-idle-primary', '#9aa4b0'),
    }

    const STYLE = {
      column: { display: 'flex', flexDirection: 'column', gap: 14, color: COLORS.text, fontSize: 13, lineHeight: 1.6 },
      card: { border: `1px solid ${COLORS.line}`, borderRadius: 10, padding: '12px 14px', background: COLORS.surface },
      cardTitle: { fontSize: 13, fontWeight: 600, margin: '0 0 8px' },
      row: { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' },
      spread: { display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'center' },
      grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '10px 14px' },
      label: { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, color: COLORS.dim },
      input: {
        font: 'inherit',
        fontSize: 12,
        padding: '6px 8px',
        borderRadius: 7,
        border: `1px solid ${COLORS.line}`,
        background: COLORS.nested,
        color: COLORS.text,
        width: '100%',
        boxSizing: 'border-box',
      },
      // A translucent neutral surface plus inherited text: this reads on a
      // light and a dark panel without the plugin guessing a contrast pair.
      // Buttons are plain divs so neither a user-agent nor the shell's own
      // `button` rules can repaint them.
      button: {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        font: 'inherit',
        fontSize: 12,
        fontWeight: 500,
        lineHeight: 1.6,
        padding: '5px 12px',
        borderRadius: 7,
        border: '1px solid rgba(128,128,128,0.45)',
        background: 'rgba(128,128,128,0.16)',
        color: 'inherit',
        cursor: 'pointer',
        userSelect: 'none',
        whiteSpace: 'nowrap',
      },
      buttonPrimary: {
        background: 'rgba(47,111,237,0.22)',
        borderColor: 'rgba(47,111,237,0.70)',
        color: 'inherit',
        fontWeight: 600,
      },
      buttonDanger: {
        background: 'rgba(214,69,56,0.16)',
        borderColor: 'rgba(214,69,56,0.70)',
        color: COLORS.bad,
      },
      badge: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        padding: '1px 9px',
        borderRadius: 999,
        border: `1px solid ${COLORS.line}`,
        fontSize: 11,
        whiteSpace: 'nowrap',
      },
      kv: { display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '4px 14px', margin: 0 },
      dt: { color: COLORS.dim, fontSize: 11 },
      dd: { margin: 0, wordBreak: 'break-all', fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace', fontSize: 11 },
      hint: { color: COLORS.dim, fontSize: 11, margin: '6px 0 0' },
      pre: {
        margin: '8px 0 0',
        padding: 10,
        borderRadius: 8,
        background: COLORS.nested,
        maxHeight: 220,
        overflow: 'auto',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-all',
        fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
        fontSize: 11,
      },
    }

    const toneOf = (level) => (level === 'bad' ? COLORS.bad : level === 'warn' ? COLORS.warn : level === 'ok' ? COLORS.ok : COLORS.dim)

    function Button({ children, onClick, disabled, tone, primary, title }) {
      const style = { ...STYLE.button }
      if (primary) Object.assign(style, STYLE.buttonPrimary)
      if (tone === 'danger') Object.assign(style, STYLE.buttonDanger)
      if (disabled === true) {
        style.opacity = 0.45
        style.cursor = 'not-allowed'
      }
      const activate = () => {
        if (disabled !== true && typeof onClick === 'function') onClick()
      }
      return h(
        'div',
        {
          role: 'button',
          tabIndex: disabled === true ? -1 : 0,
          'aria-disabled': disabled === true ? 'true' : undefined,
          title: title ?? undefined,
          style,
          onClick: activate,
          onKeyDown: (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              activate()
            }
          },
        },
        children,
      )
    }

    function Badge({ children, level }) {
      const color = toneOf(level)
      return h('span', { style: { ...STYLE.badge, color, borderColor: color } }, children)
    }

    function Card({ title, hint, actions, children }) {
      return h(
        'section',
        { style: STYLE.card },
        h(
          'div',
          { style: STYLE.spread },
          h('h3', { style: STYLE.cardTitle }, title),
          actions ? h('div', { style: STYLE.row }, actions) : null,
        ),
        children,
        hint ? h('p', { style: STYLE.hint }, hint) : null,
      )
    }

    function KV({ label, value }) {
      const text = value === undefined || value === null || value === '' ? '—' : String(value)
      return [h('dt', { key: 'k', style: STYLE.dt }, label), h('dd', { key: 'v', style: STYLE.dd }, text)]
    }

    function Field({ label, children }) {
      return h('label', { style: STYLE.label }, h('span', null, label), children)
    }

    function Check({ label, checked, onChange }) {
      return h(
        'label',
        { style: { display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, cursor: 'pointer' } },
        h('input', { type: 'checkbox', checked: checked === true, onChange: (event) => onChange(event.target.checked) }),
        h('span', null, label),
      )
    }

    const FORM_FIELDS = [
      { key: 'serverAddr', kind: 'text', placeholder: 'vps.example.com' },
      { key: 'serverPort', kind: 'number' },
      { key: 'publicUrl', kind: 'text', placeholder: 'https://dsh.example.com' },
      { key: 'remotePort', kind: 'number' },
      { key: 'proxyName', kind: 'text', placeholder: 'dsh-desktop' },
      { key: 'localHost', kind: 'text', placeholder: '127.0.0.1' },
      { key: 'frpVersion', kind: 'text', placeholder: '0.71.1' },
      { key: 'frpcPath', kind: 'text', placeholder: 'D:\\tools\\frpc.exe' },
      { key: 'tlsServerName', kind: 'text' },
      { key: 'cookieMaxAgeDays', kind: 'number' },
      { key: 'trustedHosts', kind: 'text', comma: true },
    ]

    /** One transient message inside the panel. */
    function useNotice() {
      const [notice, setNotice] = useState(null)
      const timer = useRef(undefined)
      const show = useCallback((text, bad) => {
        setNotice({ text, bad: bad === true })
        if (timer.current !== undefined) window.clearTimeout(timer.current)
        timer.current = window.setTimeout(() => setNotice(null), 6000)
      }, [])
      useEffect(() => () => { if (timer.current !== undefined) window.clearTimeout(timer.current) }, [])
      return [notice, show]
    }

    /** The whole control surface, shared by the settings page and the overlay. */
    function TunnelPanel({ t, active, onClose, embedded }) {
      const { status, error, loading, reload } = useStatus(active)
      const [notice, show] = useNotice()
      const [form, setForm] = useState(null)
      const [busy, setBusy] = useState('')
      const [secret, setSecret] = useState('')
      const [accessKey, setAccessKey] = useState('')
      const [showLogs, setShowLogs] = useState(false)
      const fileRef = useRef(null)

      // Seed the form from the Host once, and re-seed after a save.
      useEffect(() => {
        if (form !== null || status === null) return
        const config = status.config ?? {}
        setForm({
          ...config,
          trustedHosts: Array.isArray(config.trustedHosts) ? config.trustedHosts.join(', ') : '',
        })
      }, [status, form])

      const confirmAfterReload = useCallback(async () => {
        for (let attempt = 0; attempt < 24; attempt += 1) {
          await new Promise((resolve) => window.setTimeout(resolve, 700))
          try {
            // A failure here must not count as success: useStatus swallows its
            // own errors, so probe the API directly.
            await api('/status')
            await reload()
            return true
          } catch {
            // the plugin is still restarting
          }
        }
        return false
      }, [reload])

      const run = async (id, action, message) => {
        setBusy(id)
        try {
          const result = await action()
          // Some endpoints answer with a snapshot object; never hand an object
          // to React as text.
          show(typeof result === 'string' ? result : message)
        } catch (failure) {
          show(String(failure.message || failure), true)
        } finally {
          setBusy('')
        }
      }

      const saveConfig = async () => {
        if (form === null) return
        const payload = {}
        for (const field of FORM_FIELDS) {
          const value = form[field.key]
          if (field.comma) {
            payload[field.key] = String(value ?? '').split(/[,\n]/).map((item) => item.trim()).filter(Boolean)
          } else if (field.kind === 'number') {
            // An empty or malformed number must leave the stored value alone
            // rather than clamp to a nonsense port.
            const parsed = Number.parseInt(String(value ?? '').trim(), 10)
            if (Number.isFinite(parsed)) payload[field.key] = parsed
          } else {
            payload[field.key] = String(value ?? '').trim()
          }
        }
        payload.frpConfigFormat = form.frpConfigFormat === 'ini' ? 'ini' : 'toml'
        payload.enabled = form.enabled === true
        payload.tls = form.tls === true
        payload.autoApplyTrust = form.autoApplyTrust === true
        setBusy('config')
        setForm(null)
        let saveError = null
        try {
          await api('/config', payload)
        } catch (failure) {
          // Saving restarts this plugin, which can cut this response.
          saveError = failure
        }
        const ok = await confirmAfterReload()
        setBusy('')
        if (ok) show(t('saved'))
        else show(`${t('state.error')}: ${saveError ? saveError.message : 'no answer from the plugin'}`, true)
      }

      const reveal = async () => {
        setBusy('reveal')
        try {
          const info = await api('/login-info', {})
          setAccessKey(info.accessKey || '')
          show(info.accessKey ? t('copied') : t('notSet'))
        } catch (failure) {
          show(String(failure.message || failure), true)
        } finally {
          setBusy('')
        }
      }

      const copyKey = async () => {
        try {
          await navigator.clipboard.writeText(accessKey)
          show(t('copied'))
        } catch {
          show('clipboard unavailable', true)
        }
      }

      const exportJson = async () => {
        try {
          const document_ = await api('/export')
          await navigator.clipboard.writeText(JSON.stringify(document_, null, 2))
          show(t('copied'))
        } catch (failure) {
          show(String(failure.message || failure), true)
        }
      }

      const importJson = async (event) => {
        const file = event.target.files && event.target.files[0]
        event.target.value = ''
        if (!file) return
        setBusy('import')
        try {
          const parsed = JSON.parse(await file.text())
          const result = await api('/import', { document: parsed })
          setForm(null)
          const applied = await confirmAfterReload()
          const detail = result.warnings && result.warnings.length ? ` (${result.warnings.join('; ')})` : ''
          show(applied ? `${t('saved')}${detail}` : `${t('state.error')}: no answer from the plugin${detail}`, !applied)
        } catch (failure) {
          show(String(failure.message || failure), true)
        } finally {
          setBusy('')
        }
      }

      const runtime = status?.tunnel?.runtime ?? {}
      const level = runtime.proxyStarted ? 'ok' : runtime.connected ? 'warn' : runtime.state === 'running' ? 'warn' : 'bad'
      const stateKey = runtime.proxyStarted ? 'connected' : runtime.state
      const stateLabel = t(`state.${stateKey}`) === `state.${stateKey}` ? (t('unknown')) : t(`state.${stateKey}`)
      const trustLevel = status?.trust?.effective ? 'ok' : status?.trust?.pendingRestart ? 'warn' : ''
      const trustLabel = status?.trust?.effective
        ? t('trustState.live')
        : status?.trust?.pendingRestart
          ? t('trustState.pending')
          : t('trustState.none')

      const header = h(
        'div',
        { style: STYLE.spread },
        h(
          'div',
          null,
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
            h('div', { style: { fontSize: 15, fontWeight: 600 } }, t('title')),
            h(Badge, { level }, loading && status === null ? t('state.starting') : stateLabel),
            h(Badge, { level: trustLevel }, trustLabel),
          ),
          h('div', { style: { ...STYLE.hint, marginTop: 2 } }, t('subtitle')),
        ),
        h(
          'div',
          { style: STYLE.row },
          h(Button, { onClick: () => void reload(), disabled: false }, t('refresh')),
          onClose ? h(Button, { onClick: onClose }, t('close')) : null,
        ),
      )

      if (status === null) {
        return h(
          'div',
          { style: { ...STYLE.column, padding: embedded ? 0 : 16 } },
          header,
          h('div', { style: { ...STYLE.card, color: error ? COLORS.bad : COLORS.dim } }, error || '…'),
        )
      }

      const f = form ?? {
        ...(status.config ?? {}),
        trustedHosts: Array.isArray(status.config?.trustedHosts) ? status.config.trustedHosts.join(', ') : '',
      }
      const set = (key) => (event) => setForm({ ...f, [key]: event.target.value })
      const toggle = (key) => (value) => setForm({ ...f, [key]: value })
      const logs = Array.isArray(status.logs) ? status.logs : []

      return h(
        'div',
        { style: { ...STYLE.column, padding: embedded ? 0 : 16 } },
        header,
        notice ? h('div', { style: { ...STYLE.card, color: notice.bad ? COLORS.bad : COLORS.ok } }, notice.text) : null,
        error ? h('div', { style: { ...STYLE.card, color: COLORS.bad } }, error) : null,

        h(
          Card,
          {
            title: t('status'),
            hint: t('hint.status'),
            actions: [
              h(Button, { key: 'start', onClick: () => void run('start', () => api('/start', {}), t('state.running')), disabled: busy !== '' || runtime.state === 'running' }, t('start')),
              h(Button, { key: 'stop', onClick: () => void run('stop', () => api('/stop', {}), t('state.stopped')), disabled: busy !== '' || runtime.state === 'stopped' }, t('stop')),
              h(Button, { key: 'restart', onClick: () => void run('restart', () => api('/restart', {}), t('state.running')), disabled: busy !== '' }, t('restart')),
            ],
          },
          h(
            'dl',
            { style: STYLE.kv },
            h(KV, { key: 'origin', label: t('lbl.dsh'), value: status.dsh?.origin }),
            h(KV, { key: 'public', label: t('lbl.publicUrl'), value: status.tunnel?.publicUrl }),
            h(KV, { key: 'local', label: t('lbl.localPort'), value: runtime.localPort ? `127.0.0.1:${runtime.localPort}` : '—' }),
            h(KV, { key: 'version', label: t('lbl.frpcVersion'), value: runtime.frpcVersion || t('unknown') }),
            h(KV, { key: 'binary', label: t('lbl.frpcPath'), value: runtime.binaryPath || t('frpcMissing') }),
            h(KV, { key: 'error', label: t('lbl.lastError'), value: runtime.lastError || t('none') }),
          ),
        ),

        h(
          Card,
          { title: t('settings'), hint: t('hint.settings') },
          h(
            'div',
            { style: STYLE.grid },
            ...FORM_FIELDS.map((field) =>
              h(
                Field,
                { key: field.key, label: t(`field.${field.key}`) },
                h('input', {
                  type: field.kind === 'number' ? 'number' : 'text',
                  style: STYLE.input,
                  value: f[field.key] ?? '',
                  placeholder: field.placeholder ?? '',
                  spellCheck: false,
                  autoComplete: 'off',
                  onChange: set(field.key),
                }),
              ),
            ),
            h(
              Field,
              { key: 'format', label: t('field.frpConfigFormat') },
              h(
                'select',
                { style: STYLE.input, value: f.frpConfigFormat ?? 'toml', onChange: set('frpConfigFormat') },
                h('option', { value: 'toml' }, 'toml (v0.52+)'),
                h('option', { value: 'ini' }, 'ini (legacy)'),
              ),
            ),
          ),
          h(
            'div',
            { style: { ...STYLE.row, marginTop: 10 } },
            h(Check, { label: t('check.enabled'), checked: f.enabled, onChange: toggle('enabled') }),
            h(Check, { label: t('check.tls'), checked: f.tls, onChange: toggle('tls') }),
            h(Check, { label: t('check.autoApplyTrust'), checked: f.autoApplyTrust, onChange: toggle('autoApplyTrust') }),
          ),
          h(
            'div',
            { style: { ...STYLE.row, marginTop: 12 } },
            h(Button, { primary: true, onClick: () => void saveConfig(), disabled: busy !== '' }, busy === 'config' ? t('saving') : t('save')),
            busy === 'config' ? h('span', { style: { ...STYLE.hint, margin: 0 } }, t('saving')) : null,
          ),
        ),

        h(
          Card,
          {
            title: `${t('secret')} · ${status.token?.configured ? t('token.configured') : t('token.missing')}`,
            hint: t('hint.secret'),
          },
          h(
            'div',
            { style: STYLE.row },
            h('input', {
              type: 'password',
              style: { ...STYLE.input, maxWidth: 320 },
              value: secret,
              placeholder: 'frp token',
              autoComplete: 'new-password',
              onChange: (event) => setSecret(event.target.value),
            }),
            h(Button, { primary: true, disabled: secret === '' || busy !== '', onClick: () => void run('token', async () => { await api('/token', { token: secret }); setSecret(''); return t('saved') }, t('saved')) }, t('save')),
            h(Button, { tone: 'danger', disabled: busy !== '', onClick: () => void run('tokenClear', async () => { await api('/token', { token: '' }); return t('notSet') }, t('notSet')) }, t('clear')),
          ),
        ),

        h(
          Card,
          {
            title: t('trust'),
            hint: t('hint.trust'),
            actions: [
              h(Button, { key: 'apply', primary: true, disabled: busy !== '', onClick: () => void run('trust', () => api('/trust/apply', {}), t('apply')) }, t('apply')),
              h(Button, { key: 'revert', tone: 'danger', disabled: busy !== '', onClick: () => void run('revert', () => api('/trust/revert', {}), t('revert')) }, t('revert')),
            ],
          },
          h(
            'dl',
            { style: STYLE.kv },
            h(KV, { key: 'state', label: t('status'), value: trustLabel }),
            h(KV, { key: 'hosts', label: 'trustedHosts', value: (status.trust?.trustedHosts ?? []).join(', ') || t('notSet') }),
            status.trust?.error ? h(KV, { key: 'err', label: t('state.error'), value: status.trust.error }) : null,
          ),
        ),

        h(
          Card,
          { title: t('login'), hint: t('hint.login') },
          h(
            'dl',
            { style: STYLE.kv },
            h(KV, { key: 'url', label: t('field.publicUrl'), value: status.tunnel?.publicUrl || t('loginPlaceholder') }),
            h(KV, { key: 'key', label: t('accessKey'), value: accessKey || t('keyPresent') }),
          ),
          status.tunnel?.publicUrl ? null : h('p', { style: { ...STYLE.hint, color: COLORS.warn } }, t('loginUnconfigured')),
          h(
            'div',
            { style: { ...STYLE.row, marginTop: 8 } },
            h(Button, { disabled: busy !== '', onClick: () => void reveal() }, t('reveal')),
            accessKey ? h(Button, { disabled: false, onClick: () => void copyKey() }, t('copy')) : null,
          ),
        ),

        h(
          Card,
          {
            title: t('startup'),
            hint: t('hint.startup'),
            actions: [
              h(Button, { key: 'create', disabled: busy !== '' || status.startup?.supported !== true || status.startup?.exists === true, onClick: () => void run('startup', () => api('/startup/create', {}), t('saved')) }, t('create')),
              status.startup?.exists ? h(Button, { key: 'remove', tone: 'danger', disabled: busy !== '', onClick: () => void run('startupRemove', () => api('/startup/remove', {}), t('remove')) }, t('remove')) : null,
            ],
          },
          h(
            'dl',
            { style: STYLE.kv },
            h(KV, { key: 'state', label: t('status'), value: status.startup?.exists ? t('token.configured') : t('notSet') }),
            h(KV, { key: 'path', label: '.lnk', value: status.startup?.path || t('unknown') }),
          ),
        ),

        h(
          Card,
          { title: t('migration'), hint: t('hint.migration') },
          h(
            'div',
            { style: STYLE.row },
            h(Button, { disabled: busy !== '', onClick: () => void exportJson() }, t('export')),
            h(Button, { disabled: busy !== '', onClick: () => fileRef.current && fileRef.current.click() }, t('importLabel')),
            h('input', { ref: fileRef, type: 'file', accept: 'application/json', style: { display: 'none' }, onChange: (event) => void importJson(event) }),
          ),
        ),

        h(
          Card,
          { title: t('deps'), hint: t('hint.deps') },
          h(
            'dl',
            { style: STYLE.kv },
            h(KV, {
              key: 'harmony',
              label: '@dsh-harmony/plugin',
              value: status.harmony?.installed
                ? `${status.harmony.version || '?'}${status.harmony.enabled ? '' : ' (disabled)'}`
                : t('notSet'),
            }),
          ),
          status.harmony?.advice ? h('p', { style: { ...STYLE.hint, color: COLORS.warn } }, status.harmony.advice) : null,
        ),

        h(
          Card,
          {
            title: t('logs'),
            hint: t('hint.logs'),
            actions: [h(Button, { key: 'toggle', onClick: () => setShowLogs(!showLogs) }, showLogs ? t('hideLogs') : t('showLogs'))],
          },
          showLogs ? h('pre', { style: STYLE.pre }, logs.length ? logs.join('\n') : t('emptyLog')) : null,
        ),
      )
    }

    /** The settings page wrapper. */
    function SettingsSection(props) {
      return h(TunnelPanel, { t: props.t, active: true, onClose: null, embedded: true })
    }

    /** The floating overlay opened from the sidebar foot. */
    function TunnelOverlay(props) {
      const open = useOverlayOpen()
      useEffect(() => {
        if (!open) return undefined
        const onKey = (event) => {
          if (event.key === 'Escape') setOverlay(false)
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [open])
      if (!open) return null
      return h(
        'div',
        {
          style: {
            position: 'fixed',
            inset: 0,
            zIndex: 2147483000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(0,0,0,0.42)',
            // The floating layer is click-through by design; an overlay must
            // opt back in or its own controls would pass clicks to the app.
            pointerEvents: 'auto',
          },
          onMouseDown: (event) => {
            if (event.target === event.currentTarget) setOverlay(false)
          },
        },
        h(
          'div',
          {
            style: {
              width: 'min(760px, calc(100vw - 48px))',
              maxHeight: 'calc(100vh - 80px)',
              overflow: 'auto',
              borderRadius: 14,
              background: COLORS.overlay,
              boxShadow: '0 18px 60px rgba(0,0,0,0.35)',
              border: `1px solid ${COLORS.line}`,
            },
          },
          h(TunnelPanel, { t: props.t, active: open, onClose: () => setOverlay(false), embedded: false }),
        ),
      )
    }

    /** The tunnel glyph, used for the settings navigation entry. */
    function TunnelGlyph() {
      return h(
        'svg',
        { width: 18, height: 18, viewBox: '0 0 16 16', 'aria-hidden': true, style: { flex: 'none' } },
        h('path', { d: 'M2.2 13V7.6a5.8 5.8 0 0 1 11.6 0V13', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round' }),
        h('circle', { cx: 8, cy: 12.2, r: 1.5, fill: 'currentColor' }),
      )
    }

    /** The sidebar-foot entry: an icon, a live state dot, and the overlay. */
    function FooterButton(props) {
      const t = props.t
      const wide = props.wide === true
      const [level, setLevel] = useState('unknown')
      useEffect(() => {
        let alive = true
        const load = async () => {
          try {
            const status = await api('/status')
            if (!alive) return
            const runtime = status?.tunnel?.runtime ?? {}
            setLevel(runtime.proxyStarted ? 'running' : runtime.connected ? 'starting' : 'idle')
          } catch {
            if (alive) setLevel('unknown')
          }
        }
        void load()
        const timer = window.setInterval(() => {
          if (!document.hidden) void load()
        }, 15000)
        return () => {
          alive = false
          window.clearInterval(timer)
        }
      }, [])
      const dot = level === 'running' ? COLORS.ok : level === 'starting' ? COLORS.warn : COLORS.idle
      return h(
        'button',
        {
          type: 'button',
          onClick: () => setOverlay(true),
          title: t('subtitle'),
          'aria-label': t('title'),
          style: {
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            width: wide ? '100%' : 'auto',
            justifyContent: wide ? 'flex-start' : 'center',
            padding: wide ? '6px 10px' : '6px',
            borderRadius: 8,
            border: 'none',
            background: 'transparent',
            color: 'inherit',
            cursor: 'pointer',
            font: 'inherit',
            opacity: 0.9,
          },
        },
        h(
          'svg',
          { width: 16, height: 16, viewBox: '0 0 16 16', 'aria-hidden': true, style: { flex: 'none' } },
          h('path', { d: 'M2.2 13V7.6a5.8 5.8 0 0 1 11.6 0V13', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round' }),
          h('circle', { cx: 12.8, cy: 12.9, r: 2.5, fill: 'var(--dsw-alias-bg-base, #fff)' }),
          h('circle', { cx: 12.8, cy: 12.9, r: 1.9, fill: dot }),
        ),
        wide ? h('span', { style: { fontSize: 13 } }, t('title')) : null,
      )
    }

    /** Keeps one failing surface from taking the shell down. */
    class Boundary extends React.Component {
      constructor(props) {
        super(props)
        this.state = { error: null }
      }

      static getDerivedStateFromError(error) {
        return { error }
      }

      render() {
        const error = this.state.error
        if (error === null || error === undefined) return this.props.children
        return h(
          'div',
          { style: { ...STYLE.card, color: COLORS.bad } },
          `${this.props.label}: ${String((error && error.message) || error)}`,
        )
      }
    }

    const guard = (label, element) => h(Boundary, { label }, element)

    return {
      inject: ['slots'],
      apply(ctx) {
        const t = makeTranslate(ctx)
        const disposers = []
        const register = (slot, options, component) => {
          disposers.push(
            ctx.slots.inject(slot, () =>
              ctx.slots.register({ name: slot, ...options }, component),
            ),
          )
        }
        register('settings.section', { id: 'dsh-tunnel', order: 60, label: () => t('title') }, (props) =>
          guard(t('uiError'), h(SettingsSection, { ...props, t })),
        )
        register('settings.section.icon', { id: 'dsh-tunnel', order: 60, label: () => t('title') }, () =>
          guard(t('uiError'), h(TunnelGlyph)),
        )
        register('sidebar.footer.action', { id: 'dsh-tunnel', order: 20, label: () => t('title') }, (props) =>
          guard(t('uiError'), h(FooterButton, { ...props, t })),
        )
        register('shell.overlay', { id: 'dsh-tunnel', order: 100, label: () => t('title') }, () =>
          guard(t('uiError'), h(TunnelOverlay, { t })),
        )
        ctx.effect(() => () => {
          for (const dispose of disposers) {
            try {
              if (typeof dispose === 'function') dispose()
            } catch {
              // already withdrawn
            }
          }
        }, 'dsh-tunnel: surfaces')
      },
    }
  },
})
