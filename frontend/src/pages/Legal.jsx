import { Link } from 'react-router-dom'

// Privacy policy + terms of service. Template-grade for the pilot —
// have counsel review before broad commercial launch.

function LegalShell({ title, updated, children }) {
  return (
    <div className="min-h-screen bg-slate-50">
      <nav className="bg-blue-800 text-white px-4 sm:px-6 py-3">
        <Link to="/" className="font-bold text-lg tracking-tight">condo.insure</Link>
      </nav>
      <main className="max-w-2xl mx-auto px-4 py-10">
        <h1 className="text-2xl font-bold text-slate-800">{title}</h1>
        <p className="text-xs text-slate-400 mt-1 mb-8">Last updated {updated}</p>
        <div className="space-y-6 text-sm text-slate-600 leading-relaxed [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-slate-800 [&_h2]:mb-2">
          {children}
        </div>
        <p className="text-xs text-slate-400 mt-10 pt-6 border-t border-slate-200">
          Questions? Contact us at <a href="mailto:support@condo.insure" className="text-blue-600 hover:underline">support@condo.insure</a>.
        </p>
      </main>
    </div>
  )
}

export function Privacy() {
  return (
    <LegalShell title="Privacy Policy" updated="June 12, 2026">
      <section>
        <h2>What we collect</h2>
        <p>
          condo.insure helps condo associations track unit-owner insurance
          compliance. To do that we collect: account information (name, email, password), unit and
          ownership records provided by your association, and insurance documents you or your
          association upload — including declaration pages, which contain details such as your name,
          property address, insurer, policy number, and coverage amounts.
        </p>
      </section>
      <section>
        <h2>How we use it</h2>
        <p>
          Your information is used solely to provide the service: verifying insurance coverage against
          your association's requirements, notifying you and your association about policy status, and
          generating compliance reports for your association's board and management. Uploaded documents
          are processed by an AI service (Anthropic) to extract policy details; extracted data is stored
          alongside your records. We do not sell your personal information.
        </p>
      </section>
      <section>
        <h2>Who can see your data</h2>
        <p>
          Your association's authorized administrators and property managers can see the units, owners,
          and policy records for their association. Unit owners see only their own units and policies.
          Our infrastructure providers (Supabase for data hosting, Railway for application hosting,
          Resend for email, Anthropic for document processing) process data on our behalf under their
          respective terms.
        </p>
      </section>
      <section>
        <h2>Retention &amp; deletion</h2>
        <p>
          We retain records while your association maintains an account. To request deletion of your
          personal information, contact your association manager or email us directly and we will
          respond within 30 days.
        </p>
      </section>
      <section>
        <h2>Security</h2>
        <p>
          Data is encrypted in transit, access is role-restricted, and authentication is handled by
          Supabase Auth. No method of storage is 100% secure; if we learn of a breach affecting your
          personal information we will notify affected users promptly.
        </p>
      </section>
    </LegalShell>
  )
}

export function Terms() {
  return (
    <LegalShell title="Terms of Service" updated="June 12, 2026">
      <section>
        <h2>The service</h2>
        <p>
          condo.insure provides software that helps condo associations collect, verify, and track proof
          of unit-owner insurance. The service includes automated document analysis and email
          notifications. It is provided "as is" without warranty of any kind.
        </p>
      </section>
      <section>
        <h2>Not insurance or legal advice</h2>
        <p>
          condo.insure is a record-keeping and workflow tool. It does not sell insurance, is not an
          insurance carrier or licensed agent, and its automated document analysis is an aid — not a
          substitute — for your association's own review. Compliance determinations shown in the
          product are based on the rules your association configures and the documents provided, and
          may contain errors. Associations remain responsible for verifying coverage and enforcing
          their own governing documents.
        </p>
      </section>
      <section>
        <h2>Your responsibilities</h2>
        <p>
          You agree to provide accurate information, keep your login credentials secure, upload only
          documents you have the right to share, and use the service only for its intended purpose.
          Association administrators are responsible for the accuracy of unit and owner records they
          import.
        </p>
      </section>
      <section>
        <h2>Limitation of liability</h2>
        <p>
          To the maximum extent permitted by law, condo.insure is not liable for indirect, incidental,
          or consequential damages — including losses arising from lapsed coverage, denied claims, or
          decisions made in reliance on information shown in the product. Our total liability is
          limited to the amounts paid for the service in the twelve months preceding the claim.
        </p>
      </section>
      <section>
        <h2>Changes &amp; termination</h2>
        <p>
          We may update these terms with notice via the product or email. Associations may cancel at
          any time; we may suspend accounts that violate these terms. Upon cancellation, associations
          may request an export of their data.
        </p>
      </section>
    </LegalShell>
  )
}
