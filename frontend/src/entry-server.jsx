// Build-time SSR entry — NOT part of the client bundle. `npm run build` runs
// `vite build --ssr` on this file, and scripts/prerender-landing.mjs calls
// render() to bake the landing page's markup into dist/index.html's #root.
//
// Why: search engines render JS, but the LLM crawlers (GPTBot, ClaudeBot,
// PerplexityBot) mostly don't — before this, they saw `<div id="root"></div>`
// on /, so the product page was invisible to AI answers while the static
// /guides/ pages were not. Only the landing route is prerendered; a guard
// script injected next to the markup empties #root on every other path.
//
// Constraints on Landing.jsx that keep this working: browser APIs
// (window/document/localStorage/IntersectionObserver) must stay inside
// useEffect or event handlers — module scope and render must be Node-safe.
import { renderToString } from 'react-dom/server'
import { StaticRouter } from 'react-router-dom/server'
import Landing from './pages/Landing'

export function render() {
  return renderToString(
    <StaticRouter location="/">
      <Landing />
    </StaticRouter>
  )
}
