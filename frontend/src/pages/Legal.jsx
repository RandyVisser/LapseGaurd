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

function Sub({ children }) {
  return <h3 className="text-sm font-semibold text-slate-700 mt-4 mb-1">{children}</h3>
}
function Bullets({ items }) {
  return <ul className="list-disc pl-5 space-y-1 mt-1">{items.map((t, i) => <li key={i}>{t}</li>)}</ul>
}

export function Terms() {
  return (
    <LegalShell title="Terms of Service" updated="June 23, 2025">
      <p className="text-xs text-slate-400 -mt-4">condo.insure Insurance Compliance Platform · Effective June 23, 2025</p>

      <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-xs text-amber-900 font-medium">
        IMPORTANT NOTICE: By accessing or using the condo.insure Platform, you agree to be bound by these
        Terms of Service. If you do not agree to all of these terms, you must not access or use the
        Platform. Please read these terms carefully before proceeding.
      </div>

      <section>
        <h2>1. Definitions</h2>
        <p>For purposes of these Terms of Service, the following definitions apply:</p>
        <Bullets items={[
          <><strong>"Platform"</strong> means the condo.insure web application, APIs, associated software, tools, data, documentation, and all related services operated by condo.insure.</>,
          <><strong>"Company," "we," "us," or "our"</strong> refers to condo.insure and its owners, operators, employees, and agents.</>,
          <><strong>"User," "you," or "your"</strong> refers to any individual or entity that accesses or uses the Platform, including HOA board members, property managers, unit owners, and any authorized representatives.</>,
          <><strong>"Account"</strong> means a registered user account created to access the Platform.</>,
          <><strong>"Content"</strong> means all data, information, text, graphics, software, code, workflows, algorithms, and other material made available through the Platform.</>,
          <><strong>"Authorized User"</strong> means a person explicitly granted access to a specific account by an account administrator.</>,
          <><strong>"Confidential Information"</strong> means all non-public information about the Platform, including its features, workflows, pricing, code, architecture, and business logic.</>,
        ]} />
      </section>

      <section>
        <h2>2. Eligibility and Account Registration</h2>
        <Sub>2.1 Eligibility</Sub>
        <p>You must be at least 18 years of age and have the legal authority to enter into binding contracts to use the Platform. By using the Platform, you represent and warrant that you meet these requirements.</p>
        <Sub>2.2 Account Registration</Sub>
        <p>To access the Platform, you must register for an account and provide accurate, current, and complete information. You agree to keep your account information updated at all times.</p>
        <Sub>2.3 Account Security</Sub>
        <p>You are solely responsible for maintaining the confidentiality of your login credentials and for all activity that occurs under your account. You must:</p>
        <Bullets items={[
          'Use a strong, unique password for your account.',
          'Notify us immediately at support@condo.insure of any unauthorized access or suspected security breach.',
          'Never share your login credentials with any other person.',
          'Log out of your account at the end of each session.',
        ]} />
        <p className="mt-2">We reserve the right to terminate accounts found to be sharing credentials or accessed by unauthorized parties.</p>
      </section>

      <section>
        <h2>3. Authorized Use and Access Restrictions</h2>
        <Sub>3.1 License Grant</Sub>
        <p>Subject to your compliance with these Terms, we grant you a limited, non-exclusive, non-transferable, non-sublicensable, revocable license to access and use the Platform solely for your internal business purposes in connection with HOA/condominium insurance compliance management.</p>
        <Sub>3.2 Permitted Use</Sub>
        <p>You may use the Platform only for its intended purpose: tracking, verifying, and managing insurance compliance for condominium associations and HOA properties you are authorized to manage.</p>
        <Sub>3.3 Prohibited Activities</Sub>
        <p>You expressly agree NOT to, and will not permit any third party to:</p>
        <Bullets items={[
          'Access, use, or attempt to use the Platform for any purpose other than its intended function.',
          'Share, transfer, sublicense, or provide access to your account or any Platform features to any unauthorized person or entity.',
          'Use the Platform on behalf of any party you are not authorized to represent.',
          'Permit concurrent login sessions by multiple individuals using the same credentials.',
        ]} />
      </section>

      <section>
        <h2>4. Intellectual Property Rights</h2>
        <Sub>4.1 Ownership</Sub>
        <p>The Platform, including all underlying technology, software code, databases, algorithms, workflows, user interface designs, business logic, data models, methodologies, and all associated intellectual property, is and shall remain the exclusive property of condo.insure. These Terms do not grant you any ownership rights in or to the Platform.</p>
        <Sub>4.2 Prohibited IP Activities</Sub>
        <p>You are strictly prohibited from, and agree not to engage in, any of the following:</p>
        <Bullets items={[
          'Copying, reproducing, modifying, adapting, translating, or creating derivative works of the Platform or any portion thereof.',
          'Reverse engineering, decompiling, disassembling, or otherwise attempting to discover or derive the source code, algorithms, data structures, underlying ideas, or business logic of the Platform or any component thereof.',
          'Framing, mirroring, scraping, or data mining any portion of the Platform.',
          'Using automated tools, bots, crawlers, scrapers, or scripts to access, extract, or interact with Platform content.',
          'Removing, altering, or obscuring any copyright, trademark, or other proprietary rights notices on the Platform.',
          'Building or developing a competing product or service using knowledge, insights, or information derived from the Platform.',
          'Analyzing the Platform’s structure, workflows, or features for the purpose of replicating or benchmarking against a competing product.',
        ]} />
        <Sub>4.3 Trademarks</Sub>
        <p>The condo.insure name, logo, and all related marks, product names, and slogans are trademarks of condo.insure. You may not use any of our trademarks without our prior written consent.</p>
      </section>

      <section>
        <h2>5. Confidentiality and Non-Disclosure</h2>
        <Sub>5.1 Confidential Information</Sub>
        <p>You acknowledge that in the course of using the Platform, you may be exposed to Confidential Information, including but not limited to the Platform’s features, workflows, functionality, pricing structures, data models, and business logic. You agree to:</p>
        <Bullets items={[
          'Keep all Confidential Information strictly confidential.',
          'Not disclose Confidential Information to any third party without our prior written consent.',
          'Use Confidential Information solely for the purpose of using the Platform as authorized under these Terms.',
          'Take reasonable precautions to prevent unauthorized disclosure, no less stringent than the precautions you take to protect your own confidential information.',
        ]} />
        <Sub>5.2 Screenshots, Screen Recordings, and Documentation</Sub>
        <p>You are expressly prohibited from:</p>
        <Bullets items={[
          'Taking screenshots, photographs, screen recordings, or any other visual captures of the Platform interface, reports, dashboards, or any output generated by the Platform.',
          'Creating documentation, write-ups, or descriptions of the Platform’s internal workflows, screens, or features for the purpose of sharing with third parties.',
          'Sharing images, recordings, or descriptions of the Platform’s design or functionality with any competitor, developer, or unauthorized party.',
        ]} />
        <p className="mt-2">Limited exceptions may be granted with our prior written approval for specific, defined purposes such as internal training materials.</p>
        <Sub>5.3 Obligations Survive Termination</Sub>
        <p>Your confidentiality obligations under this Section 5 shall survive the termination or expiration of these Terms for a period of five (5) years.</p>
      </section>

      <section>
        <h2>6. Data, Privacy, and Security</h2>
        <Sub>6.1 Your Data</Sub>
        <p>You retain ownership of all data you submit to the Platform ("Your Data"). By submitting Your Data, you grant us a limited, non-exclusive license to process Your Data solely for the purpose of providing the Platform to you.</p>
        <Sub>6.2 Data Security</Sub>
        <p>We implement commercially reasonable technical and organizational security measures to protect Your Data. However, no method of transmission over the internet or electronic storage is 100% secure. You acknowledge that you provide Your Data at your own risk.</p>
        <Sub>6.3 Privacy Policy</Sub>
        <p>Your use of the Platform is also governed by our <Link to="/privacy" className="text-blue-600 hover:underline">Privacy Policy</Link>, which is incorporated by reference into these Terms. Please review our Privacy Policy carefully.</p>
        <Sub>6.4 Data Accuracy</Sub>
        <p>You are solely responsible for the accuracy, completeness, and legality of all data you submit to the Platform, including insurance policy information, unit owner data, and association records.</p>
      </section>

      <section>
        <h2>7. Fees, Payment, and Subscriptions</h2>
        <Sub>7.1 Subscription Fees</Sub>
        <p>Access to the Platform requires payment of applicable subscription fees as set forth in your selected plan. All fees are stated in U.S. dollars.</p>
        <Sub>7.2 Billing</Sub>
        <p>Subscription fees are billed in advance on a monthly or annual basis, depending on your selected plan. By providing payment information, you authorize us to charge your payment method for all applicable fees.</p>
        <Sub>7.3 No Refunds</Sub>
        <p>All fees are non-refundable except as expressly required by applicable law. We do not provide refunds or credits for partial months of service or unused Platform access.</p>
        <Sub>7.4 Fee Changes</Sub>
        <p>We reserve the right to modify our fees at any time with at least thirty (30) days’ prior written notice. Continued use of the Platform after a fee change constitutes your acceptance of the new fees.</p>
        <Sub>7.5 Suspension for Non-Payment</Sub>
        <p>We reserve the right to suspend or terminate your access to the Platform if any fees are not paid when due.</p>
      </section>

      <section>
        <h2>8. Disclaimers and Limitations of Liability</h2>
        <Sub>8.1 Not Legal or Insurance Advice</Sub>
        <p>THE PLATFORM IS PROVIDED FOR INFORMATIONAL AND COMPLIANCE TRACKING PURPOSES ONLY. NOTHING ON THE PLATFORM CONSTITUTES LEGAL ADVICE, INSURANCE ADVICE, OR A GUARANTEE OF INSURANCE COMPLIANCE. YOU SHOULD CONSULT WITH QUALIFIED LEGAL AND INSURANCE PROFESSIONALS FOR ADVICE SPECIFIC TO YOUR SITUATION.</p>
        <Sub>8.2 Disclaimer of Warranties</Sub>
        <p>THE PLATFORM IS PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTIES OF ANY KIND, EITHER EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, NON-INFRINGEMENT, OR ACCURACY. WE DO NOT WARRANT THAT THE PLATFORM WILL BE UNINTERRUPTED, ERROR-FREE, OR SECURE.</p>
        <Sub>8.3 Limitation of Liability</Sub>
        <p>TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, IN NO EVENT SHALL CONDO.INSURE, ITS OFFICERS, DIRECTORS, EMPLOYEES, AGENTS, OR LICENSORS BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, PUNITIVE, OR EXEMPLARY DAMAGES, OR ANY LOSS OF PROFITS, DATA, GOODWILL, OR BUSINESS OPPORTUNITIES, ARISING OUT OF OR IN CONNECTION WITH THESE TERMS OR YOUR USE OF THE PLATFORM, EVEN IF WE HAVE BEEN ADVISED OF THE POSSIBILITY OF SUCH DAMAGES.</p>
        <Sub>8.4 Total Liability Cap</Sub>
        <p>OUR TOTAL CUMULATIVE LIABILITY TO YOU FOR ANY CLAIMS ARISING OUT OF OR RELATED TO THESE TERMS OR THE PLATFORM SHALL NOT EXCEED THE GREATER OF (A) THE TOTAL FEES PAID BY YOU TO US IN THE THREE (3) MONTHS IMMEDIATELY PRECEDING THE CLAIM, OR (B) ONE HUNDRED DOLLARS ($100.00).</p>
      </section>

      <section>
        <h2>9. Indemnification</h2>
        <p>You agree to indemnify, defend, and hold harmless condo.insure and its officers, directors, employees, agents, affiliates, successors, and assigns from and against any and all claims, losses, damages, liabilities, costs, and expenses (including reasonable attorneys’ fees) arising out of or related to:</p>
        <Bullets items={[
          'Your use of or access to the Platform.',
          'Your violation of these Terms.',
          'Your violation of any applicable law or regulation.',
          'Your violation of any third-party rights, including intellectual property rights.',
          'Any data you submit to the Platform.',
          'Any unauthorized access to the Platform through your account.',
        ]} />
      </section>

      <section>
        <h2>10. Term and Termination</h2>
        <Sub>10.1 Term</Sub>
        <p>These Terms are effective upon your first access to the Platform and remain in effect until terminated.</p>
        <Sub>10.2 Termination by You</Sub>
        <p>You may terminate your account at any time by contacting us at support@condo.insure. Termination does not entitle you to any refund of prepaid fees.</p>
        <Sub>10.3 Termination by Us</Sub>
        <p>We may suspend or terminate your access to the Platform immediately, without prior notice or liability, for any reason, including if we reasonably believe you have violated these Terms. We reserve the right to terminate any account at our sole discretion.</p>
        <Sub>10.4 Effect of Termination</Sub>
        <p>Upon termination of these Terms or your account:</p>
        <Bullets items={[
          'Your license to use the Platform immediately ceases.',
          'You must immediately cease all use of the Platform.',
          'All provisions of these Terms that by their nature should survive termination shall survive, including Sections 4 (Intellectual Property), 5 (Confidentiality), 8 (Disclaimers), 9 (Indemnification), and 11 (Governing Law).',
          'We may, but are not obligated to, retain Your Data for a period following termination in accordance with our Privacy Policy.',
        ]} />
      </section>

      <section>
        <h2>11. Governing Law and Dispute Resolution</h2>
        <Sub>11.1 Governing Law</Sub>
        <p>These Terms shall be governed by and construed in accordance with the laws of the State of Florida, without regard to its conflict of law principles.</p>
        <Sub>11.2 Dispute Resolution</Sub>
        <p>Any dispute, claim, or controversy arising out of or relating to these Terms or your use of the Platform shall be resolved through binding arbitration administered by the American Arbitration Association under its Commercial Arbitration Rules. Judgment on the arbitration award may be entered in any court having jurisdiction.</p>
        <Sub>11.3 Class Action Waiver</Sub>
        <p>YOU AGREE THAT ANY DISPUTE RESOLUTION PROCEEDINGS WILL BE CONDUCTED ONLY ON AN INDIVIDUAL BASIS AND NOT IN A CLASS, CONSOLIDATED, OR REPRESENTATIVE ACTION. YOU HEREBY WAIVE YOUR RIGHT TO PARTICIPATE IN A CLASS ACTION LAWSUIT OR CLASS-WIDE ARBITRATION.</p>
        <Sub>11.4 Venue</Sub>
        <p>For any matters not subject to arbitration, you consent to the exclusive jurisdiction of the state and federal courts located in Florida, and you waive any objection to such jurisdiction or venue.</p>
      </section>

      <section>
        <h2>12. General Provisions</h2>
        <Sub>12.1 Entire Agreement</Sub>
        <p>These Terms, together with our Privacy Policy and any other agreements incorporated by reference, constitute the entire agreement between you and condo.insure with respect to the Platform and supersede all prior agreements, understandings, and representations.</p>
        <Sub>12.2 Modifications</Sub>
        <p>We reserve the right to modify these Terms at any time. We will provide notice of material changes by updating the "Last Updated" date above and, where appropriate, by sending you an email notification. Your continued use of the Platform following notice of changes constitutes your acceptance of the revised Terms.</p>
        <Sub>12.3 Severability</Sub>
        <p>If any provision of these Terms is found to be invalid, illegal, or unenforceable, the remaining provisions shall continue in full force and effect.</p>
        <Sub>12.4 Waiver</Sub>
        <p>Our failure to enforce any provision of these Terms shall not constitute a waiver of that provision or of our right to enforce it in the future.</p>
        <Sub>12.5 Assignment</Sub>
        <p>You may not assign or transfer your rights or obligations under these Terms without our prior written consent. We may freely assign these Terms without restriction.</p>
        <Sub>12.6 Force Majeure</Sub>
        <p>We shall not be liable for any delay or failure to perform our obligations under these Terms due to circumstances beyond our reasonable control, including natural disasters, acts of government, internet outages, or third-party service failures.</p>
        <Sub>12.7 No Third-Party Beneficiaries</Sub>
        <p>These Terms are for the sole benefit of you and condo.insure and do not create any third-party beneficiary rights.</p>
      </section>

      <section>
        <h2>13. Contact Information</h2>
        <p>If you have questions about these Terms of Service, please contact us at:</p>
        <p className="mt-1">Email: <a href="mailto:support@condo.insure" className="text-blue-600 hover:underline">support@condo.insure</a><br />Website: <a href="https://condo.insure" className="text-blue-600 hover:underline">https://condo.insure</a></p>
        <p className="text-xs text-slate-400 mt-4">© 2025 condo.insure. All Rights Reserved. Unauthorized reproduction or distribution of these Terms is prohibited.</p>
      </section>
    </LegalShell>
  )
}
