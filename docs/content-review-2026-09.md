# Content review — 2026-09-24 guide + site pass

Human review list for the pages changed or added on 2026-09-24. Every page is
cited to primary sources, but no human has read them. Items marked CHECK are the
agents' own readings or unverified carry-overs.

## Site copy (Randy + Troy)
- "Built by a licensed Florida insurance agency" / "the team behind universalcondo.com"
  appears on the landing hero, Who-we-are section, FAQ, /owners, /security.html and the
  Organization JSON-LD. Confirm wording and that this is the public positioning.
- Privacy policy (Legal.jsx, dated 2026-09-24) now discloses the agency relationship and
  promises an opt-out from quote offers by emailing support. Nothing in code enforces the
  opt-out — honor it manually (e.g. exclude on /admin/leads).
- /owners and owner-guide CTAs say quotes are "no cost, no obligation".

## New guides
## condo-proof-of-insurance-request-letter.html + florida-condo-master-policy-renewal.html
- HB 913 Citizens-requires-SIRS claim NOT in final bill; renewal page cites Citizens' own Nov 18 2024 bulletin instead. Check other guides for that claim.
- CHECK: "if the declaration requires coverage, failing to carry it is a declaration violation enforceable under 718.303" (agent's reading).
- CHECK: final-notice template needs counsel review (page says so).
- CHECK: 14-day notice for deductible meeting via 718.111(11)(c) "in the manner set forth in 718.112(2)(e)" cross-reference.
- CHECK: whether 627.0629(1) wind-mitigation discounts apply to commercial residential association policies (page only says "ask your agent").
- 718.111(11)(a)2 replacement cost "may be based", "at least once every 3 years" (post-HB 913 wording).
- 718.303(3) fines $100/violation, $1,000 aggregate, 14 days notice + 3-person committee, no lien.
- 627.351(6)(c)5.c Citizens 20% rule; depopulation 20% take-out.
- $40M x 5% deductible example is illustrative.
llms.txt: proof letter = "Six copy-paste templates for asking Florida condo owners for HO-6 proof of insurance (letter, email, follow-up, final notice, renewal reminder, meeting announcement), why to ask for the dec page, what to check on it, and what enforcement current law actually allows."
llms.txt: renewal = "A 120/90/60/30-day master policy renewal checklist for Florida condo boards: underwriting documents, the 3-year replacement-cost rule, Citizens' 20% rule and milestone-report requirement, how deductibles are set and shared, and why owner HO-6 loss assessment data matters."
## florida-condo-law-changes-2025-2026.html
- HB 913 = Ch. 2025-175, eff 7/1/2025; websites 25+ units eff 1/1/2026; SIRS deadline 12/31/2025; 2026 reserve threshold $25,675 (DBPR).
- 2026 session: no substantive ch. 718 changes (SB 104 reviser, HB 797 conforming). SB 1028 (Ch. 2026-150): surplus lines offer within 15% of Citizens cost -> ineligible; clearinghouse by 1/1/2027.
- CHECK: quorum — Senate summary says video participation doesn't count toward quorum; enacted 718.112(2)(b)5 says it does; page follows statute.
- CHECK: SB 1028 clearinghouse status in practice; HB 797 details omitted deliberately.
- Force-place 2010 repeal repeated from existing guide, not independently re-verified by this agent (the proof-letter agent did cite flsenate 2009 statute).
llms.txt: law changes = "Every HB 913 (Ch. 2025-175) change in one table with who it affects, effective date, statute section and source; what the 2026 session did and didn't change, including SB 1028's new Citizens eligibility rule for associations."
## florida-condo-walls-in-coverage.html + florida-ho6-insurance-cost.html
- 718.111(11)(f)1-3 quoted verbatim (2026). CHECK: our reading that drywall/doors/windows/plumbing fixtures/HVAC not named in (f)3 -> depends on declaration.
- Cost page: FLOIR Property Insurance Stability Report 7/1/2026 (data 3/31/2026) county averages; NAIC July 2026 ed (2023 data) FL HO-6 $1,146 vs $658; Citizens 2026 RECOMMENDED rates (final OIR order not found — labeled recommended).
- Fannie Mae B7-3-04 HO-6 requirement cited.
llms.txt walls-in = "What Fla. Stat. § 718.111(11)(f) requires a Florida condo master policy to cover and exclude, how to size HO-6 Coverage A to fill the gap, how deductibles and loss assessment work, and common coverage gaps."
llms.txt cost = "Sourced 2026 Florida HO-6 premium data by county (FLOIR, as of 2026-03-31), Citizens and NAIC comparisons, what drives condo unit-owner insurance prices, how to lower them, and what associations require."

## Existing guides (fact-freshness pass)
- SIRS guide: now cites 2026 statutes; 2026 session had only technical ch. 718 changes
  (SB 104 ch. 2026-14, HB 797 ch. 2026-168); 45-day SIRS rule restated per 718.112(2)(g)11–12;
  uninhabitable-building reserve pause is a board decision (718.112(2)(f)2.d.); SB 1028
  (ch. 2026-150) Citizens clearinghouse note added.
- Requirements guide: Fannie Mae B7-3-04 rewritten 2026-08-05 (per-unit deductible trigger,
  windstorm peril, max deductible greater of 5% or $2,500). CHECK: LL-2026-03 effective date
  for loans could not be fetched (403).
- Statistics guide: NAIC updated to July 2026 edition (2023 data) FL HO-6 $1,146 vs $658;
  Citizens policies in force 266,231 as of 2026-08-31.
- CHECK (not re-verified): HB 797 director details; SB 1498/1706/1497 died; Citizens HO-6
  loss assessment "can't be increased"; ISO form wording; Grife case.
