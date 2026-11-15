import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8')

/** A minimal React stand-in: enough to build and walk an element tree once. */
function reactStub() {
  const createElement = (type, props, ...children) => ({ type, props: props ?? {}, children })
  class Component {
    constructor(props) {
      this.props = props
      this.state = {}
    }
  }
  return {
    createElement,
    Component,
    useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
    useEffect: () => undefined,
    useRef: (value) => ({ current: value }),
    useCallback: (fn) => fn,
    useMemo: (fn) => fn(),
  }
}

/**
 * Loads the browser module under a fake module loader and returns it.
 * @param {{language?: string}} options - fake browser facts.
 */
function loadClient({ language = 'zh-CN' } = {}) {
  let definition = null
  const sandbox = {
    window: {
      __ModuleLoader__: {
        load: (config) => {
          definition = config
        },
      },
      addEventListener: () => {},
      removeEventListener: () => {},
      setInterval: () => 1,
      clearInterval: () => {},
      setTimeout: () => 1,
      clearTimeout: () => {},
    },
    navigator: { language, clipboard: { writeText: async () => {} } },
    document: { hidden: false },
    fetch: async () => ({ ok: true, status: 200, text: async () => '{}' }),
    console,
  }
  vm.createContext(sandbox)
  vm.runInContext(source, sandbox, { filename: 'client.js' })
  assert.ok(definition !== null, 'the module must register itself with the loader')
  return { definition, sandbox }
}

/** Walks one element tree, calling every function component. */
function walk(node, depth = 0) {
  if (node === null || node === undefined || typeof node === 'boolean') return 0
  if (typeof node === 'string' || typeof node === 'number') return 0
  if (Array.isArray(node)) return node.reduce((total, item) => total + walk(item, depth), 0)
  if (depth > 40) return 0
  if (typeof node.type === 'function') {
    let rendered
    if (typeof node.type.getDerivedStateFromError === 'function') {
      const instance = new node.type(node.props)
      rendered = node.type.prototype.render.call(instance)
    } else {
      rendered = node.type(node.props)
    }
    return 1 + walk(rendered, depth + 1)
  }
  const children = [].concat(node.children ?? [])
  return children.reduce((total, child) => total + walk(child, depth + 1), 0)
}

/** A slot registry stand-in that records what the plugin registers. */
function fakeContext(active) {
  const registrations = []
  const effects = []
  const injected = []
  const localeCalls = []
  return {
    registrations,
    registrations_effects: effects,
    injected,
    ctx: {
      get: (name) =>
        name === 'locale'
          ? {
              getLocale: () => ({ active, locales: [], revision: 1 }),
              register: (ns, id, dict) => {
                localeCalls.push({ ns, id, keys: Object.keys(dict).length })
                return () => {}
              },
              bind: (ns) => (key) => key,
            }
          : undefined,
      slots: {
        inject: (slot, callback) => {
          injected.push(slot)
          return callback()
        },
        register: (options, component) => {
          registrations.push({ options, component })
          return () => {}
        },
      },
      effect: (callback, label) => {
        effects.push(label)
        callback()
        return () => {}
      },
    },
    localeCalls,
  }
}

test('the module registers exactly the documented surfaces', () => {
  const { definition } = loadClient()
  assert.equal(definition.id, 'dsh-tunnel')
  const { ctx, registrations, injected, registrations_effects, localeCalls } = fakeContext('zh')
  const api = definition.factory((name) => (name === 'react' ? reactStub() : {}))
  assert.equal(api.inject.length, 1)
  assert.equal(api.inject[0], 'slots')
  api.apply(ctx)

  assert.deepEqual(injected.sort(), ['settings.section', 'settings.section.icon', 'shell.overlay', 'sidebar.footer.action'])
  assert.equal(registrations.length, 4)
  assert.equal(registrations_effects.length, 1)
  // A window-based surface would be dead in the desktop shell.
  assert.ok(!/window\.open\s*\(/.test(source), 'no surface may open a new window')

  const bySlot = new Map(registrations.map((entry) => [entry.options.name, entry]))
  assert.equal(bySlot.get('settings.section').options.id, 'dsh-tunnel')
  assert.equal(bySlot.get('sidebar.footer.action').options.id, 'dsh-tunnel')
  assert.equal(bySlot.get('shell.overlay').options.id, 'dsh-tunnel')
  assert.equal(bySlot.get('settings.section.icon').options.id, 'dsh-tunnel')

  // Dictionaries are registered flattened, both languages.
  assert.deepEqual(localeCalls.map((call) => call.id).sort(), ['en', 'zh'])
  assert.ok(localeCalls.every((call) => call.ns === 'dsh-tunnel'))
  assert.ok(localeCalls.every((call) => call.keys > 40))
})

test('labels follow the active locale instead of falling back to English', () => {
  for (const active of ['zh', 'zh-CN']) {
    const { definition } = loadClient()
    const { ctx, registrations } = fakeContext(active)
    definition.factory((name) => (name === 'react' ? reactStub() : {})).apply(ctx)
    const section = registrations.find((entry) => entry.options.name === 'settings.section')
    assert.equal(section.options.label(), '公网隧道', active)
  }
  const { definition } = loadClient({ language: 'en-US' })
  const { ctx, registrations } = fakeContext('en')
  definition.factory((name) => (name === 'react' ? reactStub() : {})).apply(ctx)
  const section = registrations.find((entry) => entry.options.name === 'settings.section')
  assert.equal(section.options.label(), 'Public tunnel')
})

test('the browser language is used when the shell reports no locale', () => {
  const { definition } = loadClient({ language: 'zh-CN' })
  const { ctx, registrations } = fakeContext('')
  definition.factory((name) => (name === 'react' ? reactStub() : {})).apply(ctx)
  const section = registrations.find((entry) => entry.options.name === 'settings.section')
  assert.equal(section.options.label(), '公网隧道')
})

test('every registered surface renders without throwing', () => {
  const { definition, sandbox } = loadClient()
  const { ctx, registrations } = fakeContext('zh')
  definition.factory((name) => (name === 'react' ? reactStub() : {})).apply(ctx)
  for (const entry of registrations) {
    const props = { close: () => {}, wide: true, t: (key) => key }
    let count = 0
    assert.doesNotThrow(() => {
      count = walk(entry.component(props))
    }, entry.options.name)
    assert.ok(count > 0, `${entry.options.name} rendered nothing`)
  }
  assert.ok(typeof sandbox.fetch === 'function')
})

test('the client only talks to the plugin API and never to a window', () => {
  for (const endpoint of ['/status', '/config', '/token', '/trust/apply', '/trust/revert', '/start', '/stop', '/restart', '/login-info', '/startup/create', '/startup/remove', '/export', '/import']) {
    assert.ok(source.includes(`'${endpoint}'`), `missing client call for ${endpoint}`)
  }
  assert.ok(source.includes("const API = '/dsh-tunnel/api'"))
  assert.ok(source.includes("'x-dsh-tunnel': '1'"), 'writes must carry the same-origin marker')
  assert.ok(!/window\.open\s*\(/.test(source))
  assert.ok(!source.includes('innerHTML'))
  assert.ok(!source.includes('location.assign'), 'the GUI must not be replaced')
})
