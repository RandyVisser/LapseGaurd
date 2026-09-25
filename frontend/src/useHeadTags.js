import { useEffect } from 'react'

// Per-route <head> tags for SPA pages. The static index.html head describes
// "/", so a route that needs its own description, canonical, or a robots
// directive sets it here (Google renders JS and honors these). Every tag is
// restored/removed on unmount so navigating back to "/" doesn't inherit them.
//
//   useHeadTags({ robots: 'noindex', description: '…', canonical: 'https://…' })
export default function useHeadTags({ robots, description, canonical } = {}) {
  useEffect(() => {
    const undo = []
    function setMeta(name, content) {
      if (!content) return
      let el = document.head.querySelector(`meta[name="${name}"]`)
      if (el) {
        const prev = el.getAttribute('content')
        el.setAttribute('content', content)
        undo.push(() => el.setAttribute('content', prev))
      } else {
        el = document.createElement('meta')
        el.setAttribute('name', name)
        el.setAttribute('content', content)
        document.head.appendChild(el)
        undo.push(() => el.remove())
      }
    }
    setMeta('robots', robots)
    setMeta('description', description)
    if (canonical) {
      let link = document.head.querySelector('link[rel="canonical"]')
      if (link) {
        const prev = link.getAttribute('href')
        link.setAttribute('href', canonical)
        undo.push(() => link.setAttribute('href', prev))
      } else {
        link = document.createElement('link')
        link.setAttribute('rel', 'canonical')
        link.setAttribute('href', canonical)
        document.head.appendChild(link)
        undo.push(() => link.remove())
      }
    }
    return () => undo.reverse().forEach((f) => f())
  }, [robots, description, canonical])
}
