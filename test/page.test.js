import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { renderPage } from '../src/page.js'

const html = renderPage({ version: '9.9.9' })

/** Pulls the inline script out of the rendered document. */
function inlineScript(document_) {
  const match = /<script>([\s\S]*?)<\/script>/.exec(document_)
  assert.ok(match, 'the page must carry its script inline')
  return match[1]
}

test('the page is one self-contained document', () => {
  assert.ok(html.startsWith('<!doctype html>'))
  assert.match(html, /<meta charset="utf-8">/)
  assert.match(html, /<meta name="robots" content="noindex, nofollow">/)
  assert.equal(html.split('</html>').length, 2)
  assert.ok(!html.includes('${'), 'no template placeholder may leak into the output')
  assert.ok(!/\bsrc=["']https?:/.test(html), 'no external script may be loaded')
  assert.ok(!/<link\b/.test(html), 'no external stylesheet may be loaded')
})

test('the plugin version is shown but never interpolated unsafely', () => {
  assert.match(html, /9\.9\.9/)
  const injected = renderPage({ version: '<img src=x onerror=alert(1)>' })
  assert.ok(!injected.includes('<img src=x'))
})

test('the inline script parses as JavaScript', () => {
  const script = inlineScript(html)
  assert.doesNotThrow(() => new vm.Script(script))
})

test('the script talks only to the documented endpoints', () => {
  const script = inlineScript(html)
  for (const endpoint of [
    '/status',
    '/config',
    '/token',
    '/start',
    '/stop',
    '/restart',
    '/trust/apply',
    '/trust/revert',
    '/login-info',
    '/startup/create',
    '/startup/remove',
    '/export',
    '/import',
  ]) {
    assert.ok(script.includes(`'${endpoint}'`), `missing client call for ${endpoint}`)
  }
  assert.match(script, /const API = '\/dsh-tunnel\/api'/)
  assert.match(script, /'x-dsh-tunnel': '1'/, 'writes must carry the same-origin marker')
})

test('the script inserts server data as text, never as markup', () => {
  const script = inlineScript(html)
  assert.ok(!/innerHTML/.test(script), 'the page must not build markup from API data')
  assert.match(script, /function text\(node, value\) \{ node\.textContent = /)
})

test('the stylesheet is present and theme-aware', () => {
  const match = /<style>([\s\S]*?)<\/style>/.exec(html)
  assert.ok(match)
  const css = match[1]
  assert.ok(css.length > 500)
  assert.match(css, /prefers-color-scheme: dark/)
})

test('every control the script reaches for exists in the markup', () => {
  const script = inlineScript(html)
  const ids = [...script.matchAll(/\$\('([A-Za-z0-9_-]+)'\)/g)].map((match) => match[1])
  const unique = [...new Set(ids)]
  assert.ok(unique.length > 10)
  for (const id of unique) {
    assert.ok(html.includes(`id="${id}"`), `missing element #${id}`)
  }
})

test('every config field the page renders has exactly one input', () => {
  for (const id of [
    'enabled',
    'serverAddr',
    'serverPort',
    'remotePort',
    'publicUrl',
    'localHost',
    'proxyName',
    'frpcPath',
    'frpVersion',
    'frpConfigFormat',
    'tls',
    'tlsServerName',
    'trustedHosts',
    'cookieMaxAgeDays',
    'autoApplyTrust',
  ]) {
    const count = html.split(`id="${id}"`).length - 1
    assert.equal(count, 1, `field ${id} must appear exactly once`)
  }
})
