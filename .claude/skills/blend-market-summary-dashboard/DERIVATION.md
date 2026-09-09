# Derivation — Market-wide summary (count, median, rates, activity, trending, risk profile)

This is the full reasoning and derivation behind `SKILL.md`'s query shapes
and formulas, bundled into this skill's own folder so the skill is
self-contained (it started life as UC7 in this project's broader
`blend/USE_CASES.md`, alongside UC1-UC6 for other Blend-subgraph skills —
this copy stands on its own and doesn't depend on that file).

**Ask:** across all lenders, not scoped to any one wallet: how many loans are
currently open, what's the median open-loan value, what's the going market
rate per collection, what happened in the last 24 hours (count **and total
ETH volume** per activity type, plus the rate trend), which collections are
trending by loans given or loans closed (with average loan size for the
"given" side), and — over a longer window — what's each collection's
repaid/seized/sold-locked mix and typical time-to-close. An
aggregate/statistical snapshot, not a per-loan listing.

**Why this scope:** this is meant to be the market-side reference a specific
wallet's loans get checked against later for return/refinance guidance — is
this loan's rate competitive for its collection, is this collection's
default rate elevated, is pricing trending against this position. That
downstream use is why per-collection granularity (not just market-wide
totals) matters here, unlike a simpler summary.

## Definitions

- **Open** = `status_in: [ACTIVE, IN_AUCTION]` — a loan a lender has exited
  via `startAuction` isn't closed until the borrower repays, a new lender
  refinances them out, or the auction window elapses and the lender seizes;
  an in-auction loan is not yet closed.
- **Closed** (activity/trending/risk) = a `LienEvent` with `eventType` in
  `Repay`, `Seize`, or `BuyLocked` — every terminal `LienStatus` the schema
  defines. `Refinance` and `StartAuction` are **not** closes (the loan
  continues under new terms, or is mid-auction) and get their own activity
  buckets instead.
- **Given** (trending only) = `LienEvent` with `eventType: LoanOfferTaken` —
  new originations only; `Refinance` is excluded (same lien, not a new one).
- **Activity window** = last 24 hours — activity summary, trending ranking,
  and rate-trend comparison all use this one window.
- **Risk window** = trailing 30 days — used only for the collection risk
  profile (default/seizure mix + time-to-close), deliberately wider than 24h
  since a meaningful repaid-vs-seized ratio needs more than a day of closes.
- **LTV / floor price is explicitly out of scope here.** Resolving floor
  price for every collection with an open loan (not just a ranked top-N cut)
  would mean dozens-to-hundreds of CoinGecko calls per run — deferred to a
  future wallet-merge feature that only needs floor price for the specific
  collections a given wallet holds.

## Query A — open loans (count, median, per-collection rate/depth)

```graphql
query OpenLoans($skip: Int!) {
  liens(
    first: 1000
    skip: $skip
    where: { status_in: [ACTIVE, IN_AUCTION] }
    orderBy: id
    orderDirection: asc
  ) {
    id
    status
    collection
    loanAmount
    rate
  }
}
```

Page with `skip` until empty (switch to `id_gt` cursoring — filter on
`id_gt: "<last seen id>"` instead of `skip` — if the open set ever nears
graph-node's 5000-row skip cap). `collection` and `rate` are included here
(alongside `id`/`status`/`loanAmount`) specifically so per-collection
market-rate stats can be computed from this one query, no second pass
needed.

## Query B — last-24h lien events (activity, trending, rate trend)

```graphql
query RecentActivity($since: BigInt!, $skip: Int!) {
  lienEvents(
    first: 1000
    skip: $skip
    where: { timestamp_gt: $since }
    orderBy: timestamp
    orderDirection: asc
  ) {
    id
    eventType
    timestamp
    lien {
      collection
      loanAmount
      rate
    }
  }
}
```

`lien { collection loanAmount rate }` is a nested lookup through the
`LienEvent -> Lien` relation (`LienEvent.lien: Lien!` in the subgraph
schema) — no schema or handler change needed, every field here is already
captured at event-log time. `since_24h = now_unix - 86400`, with `now_unix`
fetched **once** per invocation and reused everywhere (never refetch a
"current time" mid-computation — it should be one session-wide constant).

`lien.loanAmount`/`lien.rate` reflect the lien's *current* values at query
time. That's correct for every event type except `LoanOfferTaken`/`Refinance`
on a lien that was refinanced again later within the same 24h window — a
rare edge case, accepted rather than adding a per-event historical snapshot.

## Query C — trailing-30-day closes (collection risk profile only)

```graphql
query RecentCloses($since: BigInt!, $skip: Int!) {
  lienEvents(
    first: 1000
    skip: $skip
    where: { timestamp_gt: $since, eventType_in: ["Repay", "Seize", "BuyLocked"] }
    orderBy: timestamp
    orderDirection: asc
  ) {
    id
    eventType
    timestamp
    lien {
      collection
      createdAtTimestamp
    }
  }
}
```

`since_30d = now_unix - (30 * 86400)`, reusing the same `now_unix` as query
B. `eventType_in` is valid because `LienEvent.eventType` is a plain
`String!` field in the subgraph schema (not a GraphQL enum) — graph-node's
standard string-list filter applies to it. Filtering server-side to just the
three closing event types keeps this query's row count well below what an
unfiltered 30-day window would return. `lien.createdAtTimestamp` is the
lien's **original** origination time (distinct from `interestStartTimestamp`,
which resets on every refinance) — used to measure how long the lien existed
overall, not just its current terms.

## Derived client-side

```
# Open loans
median_eth         = median(loanAmount / 1e18 for each open loan)   # full set, not a sample
median_usd          = median_eth * eth_usd_price                     # live price
market_median_apy   = median(rate / 100 for every open loan)         # market-wide baseline

# Per-collection market rate + depth (query A, grouped by collection)
open_count_by_collection = count of open loans per collection
eth_locked_by_collection  = sum(loanAmount / 1e18) per collection
median_apy_by_collection  = median(rate / 100) per collection
min_apy_by_collection     = min(rate / 100) per collection
max_apy_by_collection     = max(rate / 100) per collection
top10_by_depth            = open_count_by_collection, sorted desc, top 10

# Activity, last 24h — group query B by eventType, both count AND total ETH
# (sum of lien.loanAmount / 1e18) per bucket
closed_total_count = count(Repay) + count(Seize) + count(BuyLocked)
closed_total_eth   = sum_eth(Repay) + sum_eth(Seize) + sum_eth(BuyLocked)

# 24h rate trend (query B's LoanOfferTaken events vs. query A's open-loan baseline)
median_apy_given_24h   = median(rate / 100 for LoanOfferTaken events in query B)
                          # "N/A" if zero loans given in the window
market_apy_trend_delta  = median_apy_given_24h - market_median_apy
median_apy_given_24h_by_collection = same, grouped by lien.collection
                                       # only for collections with >=1 given event

# Trending, last 24h — group query B by lien.collection
given_by_collection     = count(LoanOfferTaken) per collection
given_eth_by_collection = sum_eth(LoanOfferTaken) per collection
avg_given_size_eth      = given_eth_by_collection / given_by_collection
closed_by_collection = count(Repay + Seize + BuyLocked) per collection
top5_given  = given_by_collection, sorted desc, top 5   # shown with avg_given_size_eth
top5_closed = closed_by_collection, sorted desc, top 5

# Collection risk profile, trailing 30d — group query C by lien.collection
closed_30d_by_collection      = count of closing events per collection
repay_rate_pct_by_collection   = count(Repay) / closed_30d * 100
seize_rate_pct_by_collection   = count(Seize) / closed_30d * 100
sold_locked_rate_pct_by_collection = count(BuyLocked) / closed_30d * 100
avg_time_to_close_days_by_collection =
    mean((event.timestamp - lien.createdAtTimestamp) / 86400)
    over that collection's 30d closed events
top10_by_30d_closes = closed_30d_by_collection, sorted desc, top 10

# Market-wide risk headline — aggregated across ALL collections from query C,
# not just the printed top 10
market_closed_30d          = sum(closed_30d_by_collection)
market_repay_rate_pct       = sum(repay counts) / market_closed_30d * 100
market_seize_rate_pct       = sum(seize counts) / market_closed_30d * 100
market_sold_locked_rate_pct = sum(sold-locked counts) / market_closed_30d * 100
market_avg_time_to_close_days = mean over every query C closed event
```

`avg_given_size_eth` is the average size of just that collection's
`LoanOfferTaken` events in the 24h window — not an average over its whole
open-loan book (that would mix in loans originated well before the window).
The 30-day risk profile is a **closed-loan** metric: it describes how
lenders who exited a collection in the last month fared, not the health of
currently open positions (LTV would be needed for that, and is out of scope
here per the Definitions section above).

## Collection names — resolve once, for the union of all four ranked lists

Ranking works on raw collection addresses. Name resolution — CoinGecko's
NFT-by-contract endpoint for `name`, falling back to an on-chain `eth_call`
to `name()` (selector `0x06fdde03`, ABI-decode the returned string) if that
404s, falling back further to the raw collection address if both fail — only
needs to run once per distinct collection appearing in **any** of
`top5_given`, `top5_closed`, `top10_by_depth`, or `top10_by_30d_closes` — a
collection landing in more than one list (common) should not be resolved
twice.

## Why this doesn't need any schema changes

Every field this use case needs — `loanAmount`, `rate`, `status`,
`collection`, `createdAtTimestamp` on `Lien`; `eventType`, `timestamp`, and
the `lien` relation on `LienEvent` — is already part of the standard Blend
subgraph schema. This is a pure aggregation use case: same underlying data,
different query shape (bulk fetch + client-side grouping/ranking instead of
a filtered per-loan list).

## Delivery — persistent web dashboard artifact, not an email

The skill publishes a two-chart dashboard using data already computed above
(no new queries): a bar chart of `median_apy_by_collection` for
`top10_by_depth`, and a scatter/bubble chart plotting
`median_apy_by_collection` against `seize_rate_pct_by_collection` (bubble
size = `open_count_by_collection`) for collections present in both
`top10_by_depth` and `top10_by_30d_closes` — the risk-adjusted-return view
that this whole use case exists to support.

Published once and **redeployed to the same link on every run** (the URL is
saved as a `reference` memory after the first publish), rather than a new
artifact per invocation, so the dashboard is a stable bookmark that always
reflects the latest data. There is a sibling skill, `blend-market-summary`,
that delivers the same underlying data as a plain-text email instead — use
that one when the ask is specifically to be emailed the report rather than
shown/linked a dashboard.

**The dashboard's design is a fixed, checked-in template
(`TEMPLATE.html`, in this skill's own folder), not something generated
fresh each run.** An earlier version of this skill invoked the `dataviz`/
`artifact-design` skills to design the dashboard from scratch on every
first publish — which meant a brand-new copy of this skill (no saved
artifact-URL memory yet) produced a visibly different look each time a
fresh "first publish" happened, since each design pass is an independent
creative act. `TEMPLATE.html` closes that off: every publish and redeploy
starts from the same known-good HTML, and the only thing that ever changes
is a handful of data constants in its `<script>` block (clearly marked off
from the fixed rendering code below them). See `SKILL.md` step 7 for the
full publish/redeploy instructions.
