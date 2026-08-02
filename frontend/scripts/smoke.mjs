/* CI smoke test — does the built app actually RENDER?
 *
 * ci.yml proves the frontend builds and the backend imports. Neither catches a
 * white screen: a runtime error on module init produces a perfectly successful
 * build and a blank page. This is the cheapest check that closes that gap.
 *
 * Serves dist/ locally and asserts, per route:
 *   - HTTP 200
 *   - #root actually has rendered children (not a white screen)
 *   - no uncaught page errors and no console errors
 *
 * Deliberately UNAUTHENTICATED and offline-ish: it never logs in and never
 * touches production data. An authenticated end-to-end run would have to hit
 * prod (there is no staging), which is a separate decision — see the note in
 * the CI job.
 *
 * Playwright is installed transiently by the CI step (`npm i --no-save`) so it
 * never becomes a committed devDependency — CLAUDE.md keeps test/promo tooling
 * out of this repo, and this is CI infrastructure rather than a local harness.
 */
import { spawn } from 'node:child_process'
import { chromium } from 'playwright'

const PORT = 4178
const BASE = `http://localhost:${PORT}`

// SPA routes must render via React. Static pages must contain their own markup.
const SPA_ROUTES = ['/', '/login', '/signup', '/privacy', '/terms']
const STATIC_PAGES = [
  '/guides/index.html',
  '/guides/florida-condo-insurance-requirements.html',
]
// Files that must NOT be swallowed by the SPA catch-all (see frontend/CLAUDE.md).
const RAW_FILES = [
  ['/robots.txt', /^text\/plain/],
  ['/sitemap.xml', /^application\/xml/],
  ['/llms.txt', /^text\/plain/],
]

const server = spawn('npx', ['serve', 'dist', '-l', String(PORT)], { stdio: 'ignore' })
const fail = []

const ready = async () => {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(BASE + '/')
      if (r.ok) return true
    } catch { /* not up yet */ }
    await new Promise(r => setTimeout(r, 250))
  }
  return false
}

try {
  if (!await ready()) throw new Error(`server never came up on ${PORT}`)

  const browser = await chromium.launch()

  for (const route of SPA_ROUTES) {
    const page = await browser.newPage()
    const errors = []
    page.on('pageerror', e => errors.push(`pageerror: ${e.message}`))
    page.on('console', m => { if (m.type() === 'error') errors.push(`console: ${m.text()}`) })

    const res = await page.goto(BASE + route, { waitUntil: 'networkidle' })
    if (res.status() !== 200) fail.push(`${route}: HTTP ${res.status()}`)

    // The white-screen check: React must have put something in #root.
    const rendered = await page.evaluate(() => {
      const el = document.getElementById('root')
      return el ? el.children.length : -1
    })
    if (rendered <= 0) fail.push(`${route}: #root has no children — WHITE SCREEN`)

    // Network failures to the API are expected here (no backend in CI); ignore
    // those and only surface genuine JS breakage.
    const real = errors.filter(e => !/Failed to fetch|net::|NetworkError|ERR_/i.test(e))
    if (real.length) fail.push(`${route}: ${real.slice(0, 2).join(' | ')}`)

    console.log(`  ${fail.length ? ' ' : ''}${route} → ${res.status()}, #root children: ${rendered}`)
    await page.close()
  }

  for (const route of STATIC_PAGES) {
    const page = await browser.newPage()
    const res = await page.goto(BASE + route, { waitUntil: 'domcontentloaded' })
    const info = await page.evaluate(() => ({
      h1: document.querySelector('h1')?.textContent?.trim() || null,
      hasRoot: !!document.getElementById('root'),
    }))
    if (res.status() !== 200) fail.push(`${route}: HTTP ${res.status()}`)
    if (!info.h1) fail.push(`${route}: no <h1> — is the SPA catch-all serving it?`)
    if (info.hasRoot) fail.push(`${route}: contains #root — SPA fallback ate this static page`)
    console.log(`  ${route} → ${res.status()}, h1: ${JSON.stringify(info.h1?.slice(0, 40))}`)
    await page.close()
  }

  for (const [path, expected] of RAW_FILES) {
    const r = await fetch(BASE + path)
    const ct = r.headers.get('content-type') || ''
    if (!expected.test(ct)) fail.push(`${path}: content-type "${ct}" — expected ${expected}`)
    console.log(`  ${path} → ${r.status} ${ct}`)
  }

  await browser.close()
} catch (err) {
  fail.push(`harness error: ${err.message}`)
} finally {
  server.kill()
}

if (fail.length) {
  console.error('\nSMOKE FAILED:')
  for (const f of fail) console.error('  ✗ ' + f)
  process.exit(1)
}
console.log('\nsmoke OK')
