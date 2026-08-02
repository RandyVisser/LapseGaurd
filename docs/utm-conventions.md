# Outbound link tagging (UTM) — conventions

> Companion doc: `docs/cold-email-warmup.md` — the sending-domain ramp-up
> schedule for the lookalike domain used with these tagged links.


**Why:** the analytics beacon (`frontend/src/analytics.js`) already captures
first-touch campaign tags and the super-user funnel card groups by them
(`backend/routes/analytics.py`, "Where visitors came from"). Nothing needs to
be built — but outbound links only attribute if they carry a tag. Untagged
clicks all pile into "direct" and are indistinguishable from bots.

The beacon reads these query keys (first-touch wins; the tag persists in
`localStorage['ci.utm']` even after navigation strips the query string):
`utm_source`, `utm_medium`, `utm_campaign`, `src`, `ref`.

## The scheme

- `utm_source` = the **channel**: `apollo` (cold email) | `mailer` (physical mail)
- `utm_campaign` = the **segment**: `broward-pm` | `palmbeach-pm`
- Printed mailers use the short `src=` alias instead (typeable off paper).

**Spell the values identically every time.** The funnel buckets by the literal
tag string — `broward-pm` and `Broward_PM` show up as two separate rows.

Always use the `www.` host in clickable links (the bare domain 301s). For
printed mailers the short bare-domain form is fine — the 301 preserves the
query string.

## Canonical links

Apollo cold email (clicked, not typed — full tags):

    Broward PM firms:     https://www.condo.insure/?utm_source=apollo&utm_campaign=broward-pm
    Palm Beach PM firms:  https://www.condo.insure/?utm_source=apollo&utm_campaign=palmbeach-pm

Printed PM-firm mailers (short, typeable):

    Broward:     condo.insure/?src=mail-bwd
    Palm Beach:  condo.insure/?src=mail-pb

## Already covered — do NOT tag

**Vista Royale owner mailers** point at the `/vista_royale` landing page and are
attributed by *destination page* via the allow-listed `vista_royale_view`
event — not a UTM tag. Keep pointing that batch at `condo.insure/vista_royale`.

## Adding a channel/segment later

Pick a new `utm_source` (channel) and/or `utm_campaign` (segment) value, add the
link here, and reuse the exact string forever. No code change is ever required —
the beacon reads whatever tag the link carries.
