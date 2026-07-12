import { useEffect, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import Nav from '../components/Nav'
import PmTeamPanel from '../components/PmTeamPanel'
import PmBillingPanel from '../components/PmBillingPanel'
import FirmDirectory from '../components/FirmDirectory'
import { apiGet } from '../supabase'
import { useAuth } from '../context/AuthContext'

const BILLING_ENABLED = import.meta.env.VITE_BILLING_ENABLED === 'true'

// The firm home: everything firm-level in one place.
//  - property managers: their team (roster, visibility, assignments) and the
//    firm's billing (consolidated or pass-through)
//  - super users: the directory of all firms + independent associations
// Everyone else is bounced to the dashboard.
export default function AdminFirm() {
  const { role, availableHoas, setSelectedHoaId } = useAuth()
  const navigate = useNavigate()
  const [firms, setFirms] = useState([])

  useEffect(() => {
    if (role === 'super_user') apiGet('/firms').then(setFirms).catch(() => {})
  }, [role])

  if (role && role !== 'property_manager' && role !== 'super_user') {
    return <Navigate to="/admin/dashboard" replace />
  }

  function openHoa(id) {
    setSelectedHoaId(id)
    navigate('/admin/settings')
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <Nav role="hoa_admin" />
      <main className="max-w-[50rem] mx-auto px-4 py-8">
        <div className="mb-6">
          <h1 className="text-xl font-bold text-[#0B1B33]">
            {role === 'super_user' ? 'PM Firms' : 'Your Firm'}
          </h1>
          <p className="text-sm text-[#54627A] mt-1">
            {role === 'super_user'
              ? 'Every property-management firm on the platform, and who they manage.'
              : 'Your team, who sees which associations, and how the portfolio is billed.'}
          </p>
        </div>

        {role === 'property_manager' && (
          <>
            <PmTeamPanel />
            {BILLING_ENABLED && <PmBillingPanel />}
          </>
        )}

        {role === 'super_user' && (
          <FirmDirectory firms={firms} availableHoas={availableHoas} onOpenHoa={openHoa} />
        )}
      </main>
    </div>
  )
}
