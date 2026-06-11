import { useEffect, useState } from 'react'

// True below the given width (default: tailwind md breakpoint).
// Tracks live so rotating / resizing switches layouts without a reload.
export default function useIsMobile(breakpoint = 768) {
  const query = `(max-width: ${breakpoint - 1}px)`
  const [isMobile, setIsMobile] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const mq = window.matchMedia(query)
    const onChange = e => setIsMobile(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [query])
  return isMobile
}
