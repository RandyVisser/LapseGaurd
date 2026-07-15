import { useEffect } from 'react'

// Browser-tab title for a page: "Dashboard · condo.insure". Pass a falsy
// title to leave the bare brand (e.g. while data is still loading).
export default function usePageTitle(title) {
  useEffect(() => {
    document.title = title ? `${title} · condo.insure` : 'condo.insure'
    return () => { document.title = 'condo.insure' }
  }, [title])
}
