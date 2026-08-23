// Injects the SSR-rendered landing markup (see src/entry-server.jsx) into
// dist/index.html so non-JS crawlers get real content on /.
//
// Runs after BOTH builds: the client build (produces dist/index.html) and the
// SSR build (produces dist-server/entry-server.js). Fails loudly — a broken
// prerender should fail CI, not silently ship an empty root again.
//
// The guard script injected alongside the markup empties #root on any path
// other than "/": every SPA route serves this same index.html (catch-all
// rewrite), and without the guard a user opening /login or /admin/dashboard
// would see the landing page flash until React mounts. With it, non-landing
// routes start from an empty root exactly as before this existed.
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const indexPath = path.join(here, '..', 'dist', 'index.html')
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
html = html.replace(MARKER, `<div id="root">${body}</div>${GUARD}`)
writeFileSync(indexPath, html)
console.log(`[prerender-landing] injected ${body.length} chars of landing markup into dist/index.html`)
