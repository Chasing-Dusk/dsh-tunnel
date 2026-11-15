/**
 * The browser half of dsh-tunnel.
 *
 * It adds one entry beside Settings in the sidebar foot that opens the control
 * page, and colours it from the tunnel's own status endpoint so the state is
 * visible without opening anything. Everything is inert when the page cannot
 * be reached: a status fetch failure just leaves the dot grey.
 */
window.__ModuleLoader__.load({
  id: 'dsh-tunnel',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const SLOT = 'sidebar.footer.action'
    const ID = 'dsh-tunnel'
    const PAGE = '/dsh-tunnel/'
    const STATUS = '/dsh-tunnel/api/status'

    const STRINGS = {
      en: {
        title: 'Public tunnel',
        open: 'Open the public tunnel control page',
        running: 'Tunnel connected',
        idle: 'Tunnel not connected',
        unknown: 'Tunnel status unknown',
      },
      zh: {
        title: '公网隧道',
        open: '打开公网隧道控制页',
        running: '隧道已连接',
        idle: '隧道未连接',
        unknown: '隧道状态未知',
      },
    }

    /** Resolves the dictionary for the active locale, defaulting to English. */
    function dictionary(ctx) {
      let id = ''
      try {
        const locale = ctx.get?.('locale')
        const snapshot = locale?.getLocale?.() ?? locale?.getSnapshot?.()
        id = typeof snapshot?.id === 'string' ? snapshot.id : typeof snapshot?.locale === 'string' ? snapshot.locale : ''
        if (id !== '' && locale?.register !== undefined) {
          locale.register('dsh-tunnel', 'en', STRINGS.en)
          locale.register('dsh-tunnel', 'zh', STRINGS.zh)
        }
      } catch {
        // The page is still usable without the locale service.
      }
      return id.toLowerCase().startsWith('zh') ? STRINGS.zh : STRINGS.en
    }

    /** One 15 s poll of the tunnel status, kept out of React state churn. */
    function useTunnelHealth() {
      const [level, setLevel] = React.useState('unknown')
      React.useEffect(() => {
        let alive = true
        const load = async () => {
          try {
            const response = await fetch(STATUS, { headers: { 'x-dsh-tunnel': '1' }, cache: 'no-store' })
            if (!response.ok) {
              if (alive) setLevel('idle')
              return
            }
            const status = await response.json()
            const runtime = status?.tunnel?.runtime ?? {}
            if (alive) setLevel(runtime.proxyStarted ? 'running' : runtime.connected ? 'starting' : 'idle')
          } catch {
            if (alive) setLevel('unknown')
          }
        }
        void load()
        const timer = window.setInterval(load, 15000)
        return () => {
          alive = false
          window.clearInterval(timer)
        }
      }, [])
      return level
    }

    /** The sidebar-foot button: an icon, a state dot, and the page opener. */
    function TunnelButton(props) {
      const strings = props.strings ?? STRINGS.en
      const level = useTunnelHealth()
      const wide = props.wide === true
      const color = level === 'running' ? '#2fbf71' : level === 'starting' ? '#e0a33a' : '#9aa4b0'
      const title = level === 'running' ? strings.running : level === 'unknown' ? strings.unknown : strings.idle
      const open = () => {
        window.open(PAGE, '_blank', 'noopener,noreferrer')
      }
      return h(
        'button',
        {
          type: 'button',
          onClick: open,
          title: `${title} — ${strings.open}`,
          'aria-label': strings.title,
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
            opacity: 0.85,
          },
        },
        h(
          'svg',
          { width: 16, height: 16, viewBox: '0 0 16 16', 'aria-hidden': true, style: { flex: 'none' } },
          h('circle', { cx: 7, cy: 5, r: 2.6, fill: 'none', stroke: 'currentColor', strokeWidth: 1.4 }),
          h('path', { d: 'M2.4 13.2c.5-2.4 2.4-3.7 4.6-3.7s4.1 1.3 4.6 3.7', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round' }),
          h('circle', { cx: 12.6, cy: 12.4, r: 2.4, fill: 'var(--dsh-surface, #fff)', stroke: 'none' }),
          h('circle', { cx: 12.6, cy: 12.4, r: 1.9, fill: color }),
        ),
        wide ? h('span', { style: { fontSize: 13 } }, strings.title) : null,
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        const strings = dictionary(ctx)
        const register = () =>
          ctx.slots.register({ name: SLOT, id: ID, order: 20, label: strings.title }, (props) =>
            h(TunnelButton, { ...props, strings }),
          )
        ctx.slots.inject(SLOT, () => register())
      },
    }
  },
})
