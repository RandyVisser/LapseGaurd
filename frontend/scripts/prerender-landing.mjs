// Injects the SSR-rendered landing markup (see src/entry-server.jsx) into
// dist/index.html so non-JS crawlers get real content on /.
//
// Runs after BOTH builds: the client build (produces dist/index.html) and the
// SSR build (produces dist-server/entry-server.js). Fails loudly — a broken
// prerender should fail CI, not silently ship an empty root again.
//
// Two files come out of this:
//   dist/index.html — the PRERENDERED landing. Served for "/" only.
//   dist/app.html   — the bare SPA shell (empty #root). serve.json's catch-all
//                     rewrite points every other route (/join/…, /owners,
//                     /login, …) here.
// Before the split, every route got the prerendered landing body in its raw
// HTML: invitees and postcard owners on slow phones saw the board pitch (and
// `curl /join/abc` showed the landing H1) until React mounted. A client-side
// guard script can't fix that for non-JS clients or a slow first paint, so the
// shell is now a separate file. app.html also drops the landing-only <head>
// items — the canonical pointing at "/" (it would tell Google every SPA route
// is a duplicate of the homepage) and the FAQPage/Organization JSON-LD (marked-
// up answers must be visible on the page they're on).
//
// The guard script is kept as belt-and-braces for anyone reaching the
// prerendered file under another path (e.g. /index.html?next=…).
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const indexPath = path.join(here, '..', 'dist', 'index.html')
const shellPath = path.join(here, '..', 'dist', 'app.html')
const entryPath = path.join(here, '..', 'dist-server', 'entry-server.js')

const { render } = await import(pathToFileURL(entryPath).href)
const body = render()
if (!body || body.length < 5000) {
  throw new Error(`[prerender-landing] suspiciously small render (${body ? body.length : 0} chars) — Landing markup missing?`)
}

const MARKER = '<div id="root"></div>'
const GUARD = '<script>if(location.pathname!=="/"){var r=document.getElementById("root");if(r)r.textContent=""}</script>'

let html = readFileSync(indexPath, 'utf8')
if (!html.includes(MARKER)) {
  throw new Error(`[prerender-landing] ${MARKER} not found in dist/index.html — template changed?`)
}
// Bare shell for every non-"/" route (see header comment).
const shell = html
  .replace(/\s*<link rel="canonical"[^>]*>/, '')
  .replace(/\s*<!--\s*Structured data\.[\s\S]*?-->/, '')
  .replace(/\s*<script type="application\/ld\+json">[\s\S]*?<\/script>/g, '')
if (!shell.includes(MARKER) || shell.includes('application/ld+json') || shell.includes('rel="canonical"')) {
  throw new Error('[prerender-landing] failed to build a clean app.html shell')
}
writeFileSync(shellPath, shell)

html = html.replace(MARKER, `<div id="root">${body}</div>${GUARD}`)
writeFileSync(indexPath, html)
console.log(`[prerender-landing] wrote bare SPA shell to dist/app.html (${shell.length} chars)`)
console.log(`[prerender-landing] injected ${body.length} chars of landing markup into dist/index.html`)
