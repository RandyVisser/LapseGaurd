# Cold-email sending-domain ramp-up (warm-up) schedule

Companion to `docs/utm-conventions.md`. This covers the **lookalike domain +
Google Workspace mailbox** used for Apollo cold outreach. Cold email NEVER goes
through Resend / `send.condo.insure` — a spam complaint on the product domain
would land real renewal alerts and invites in spam for actual customers. The
lookalike domain is the disposable buffer that protects it.

Warming = ramping send volume slowly so mailbox providers (Gmail/Outlook) build
sender reputation before you go full-volume. Blast a cold domain on day one and
it gets filtered to spam permanently.

## Before any sending

- **Auth records on the lookalike domain**: SPF, DKIM, and DMARC all set and
  passing. This is non-negotiable — missing DKIM alone tanks a new domain.
- **Verify every address in Apollo before sending.** Bounce rate is the fastest
  reputation-killer; keep it **under ~3%**. A bad list burns the domain no
  matter how careful the ramp is.
- **One mailbox to start.** Scale by adding a second mailbox later, not by
  pushing one past ~50 cold sends/day.

## Ramp schedule (single mailbox)

Warm-up tool (Apollo's, or Instantly/Warmup-Inbox style) runs the whole time —
it auto-sends/opens/replies among seed inboxes to build a positive engagement
history underneath the real sends.

| Phase | Cold sends/day | Notes |
|-------|----------------|-------|
| **Week 1** | 0 (warm-up tool only) → ramp tool to ~20/day | No real prospects yet. Pure reputation-building. |
| **Week 2** | 5 → 10/day real | Smallest, highest-quality verified batches first. Watch bounces. |
| **Week 3** | 15 → 25/day real | Scale only if bounce <3% and replies look human. |
| **Week 4+** | ~40–50/day steady | Steady state per mailbox. Keep warm-up running in the background. |

### Calendar (domain started warming 2026-07-08)

| Phase | Dates |
|-------|-------|
| Week 1 | 2026-07-08 → 07-14 |
| Week 2 | 2026-07-15 → 07-21 |
| Week 3 | 2026-07-22 → 07-28 |
| Week 4 / steady state | 2026-07-29 onward |

On paper the domain finishes warm-up ~**2026-07-29**, ready for ~40–50 real
cold sends/day. **Reconcile with what actually happened** — as of 07-28 Apollo
was still unconnected, so it's unclear whether real warm-up ran or the domain
just sat idle. If sending never actually started, restart the clock from the
first real ramp day; an idle domain isn't a warmed one.

## Guardrails during steady state

- Bounce rate < 3%, spam-complaint rate < 0.1%.
- Spread sends across business hours; don't fire the whole batch at once.
- Keep the warm-up tool running even at steady state.
- Tag every link per `docs/utm-conventions.md` so clicks attribute
  (`utm_source=apollo&utm_campaign=broward-pm` / `palmbeach-pm`).
