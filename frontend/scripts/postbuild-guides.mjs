/* Substitute the API base into the static guide analytics beacon.
 *
 * Why this exists: files in public/ are copied verbatim by Vite, so
 * import.meta.env is not available inside them. The /guides/ pages are static
 * HTML (deliberately — they must be readable by crawlers that don't run JS), so
 * their beacon needs the backend URL baked in some other way. This is that way.
 *
 * Runs after `vite build` via the npm "build" script.
 *
 * If VITE_API_URL is absent this WARNS rather than failing: CI builds the
 * frontend without any env vars and must stay green. The beacon script itself
 * detects the unsubstituted placeholder and disables itself with a console
 * warning, so the failure mode is "no guide analytics", never a broken page or
 * beacons fired at a bogus URL.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadEnv } from 'vite'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const target = resolve(root, 'dist/guides/guide-analytics.js')

if (!existsSync(target)) {
  console.warn('[postbuild-guides] dist/guides/guide-analytics.js not found — skipping.')
  process.exit(0)
}

// loadEnv reads .env files AND process.env, matching how Vite resolves VITE_*.
const env = loadEnv(process.env.NODE_ENV || 'production', root, 'VITE_')
const apiBase = (env.VITE_API_URL || process.env.VITE_API_URL || '').replace(/\/+$/, '')

const src = readFileSync(target, 'utf8')

if (!apiBase) {
  console.warn(
    '[postbuild-guides] VITE_API_URL is not set — guide analytics will be DISABLED in this build.\n' +
    '                   Expected in Railway (declared ARG+ENV in Dockerfile.prod). Normal for CI.'
  )
  process.exit(0)
}

if (!src.includes('__API_BASE__')) {
  console.warn('[postbuild-guides] placeholder __API_BASE__ not found — already substituted?')
  process.exit(0)
}

writeFileSync(target, src.replaceAll('__API_BASE__', apiBase), 'utf8')
console.log(`[postbuild-guides] guide analytics API base -> ${apiBase}`)
