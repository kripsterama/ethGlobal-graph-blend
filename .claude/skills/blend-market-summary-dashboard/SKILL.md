---
name: blend-market-summary-dashboard
description: >-
  Query the Blend subgraph for a market-wide snapshot across all lenders:
  open-loan count and median value, per-collection market rate stats
  (median/min/max APY, depth, ETH locked), 24h activity (new/closed/
  refinanced/auction-started loans, count and ETH volume) plus the 24h rate
  trend, 24h trending collections by loans given or closed, and a
  trailing-30-day collection risk profile (repaid/seized/sold-locked mix,
  average time-to-close). Publishes a persistent, interactive two-chart web
  dashboard (market rate by collection, rate vs. 30-day seize risk)
  redeployed to the same link every run, rather than an email. Meant as the
  market-side reference for comparing a wallet's loans against — not a
  per-loan listing (use blend-active-loans for that). Use for: market
  summary, how many active Blend loans, median loan size, market rate for a
  collection, loan activity in the last day, trending collections,
  default/seizure rate, market dashboard/charts, show me the dashboard.
---

# Blend Market Summary — Dashboard

Aggregates `Lien` and `LienEvent` data from the Blend subgraph across **all**
lenders into a market-wide snapshot: open-loan count/median, per-collection
market rate and depth stats, 24h activity and rate trend, 24h trending
collections, and a trailing-30-day collection risk profile. See
`DERIVATION.md` (in this skill's own folder) for the full derivation and
reasoning behind these definitions — this skill just executes that end to
end.

**Delivery is a published, interactive web dashboard artifact, not an
email.** Two charts (live SVG/JS, hover tooltips) on one page, redeployed to
the same URL every run so the link is a stable bookmark that always shows
the latest data. There is a sibling skill, `blend-market-summary` (email
delivery, static PNG charts) — use that one instead if the user specifically
asks to be emailed the report; this one is for "show me," "dashboard," or
"link" requests.

**Purpose beyond the raw numbers:** this data is meant to be the market-side
reference a specific wallet's loans get compared against later (is this
loan's rate competitive for its collection? Is this collection's default
rate elevated? Is pricing trending against this position?) — so precision on
per-collection stats matters more here than in a plain listing skill.

This is a stats/summary skill, not a per-loan listing — don't print a
row-per-loan table here. For that, point the user at `blend-active-loans`.

## Definitions (fixed, don't reinterpret per invocation)

- **Open** = `status_in: [ACTIVE, IN_AUCTION]` — same definition
  `blend-active-loans` uses (a loan a lender exited via `startAuction` isn't
  closed until repaid, refinanced out, or seized).
- **Closed** (for the activity/trending/risk sections) = a `LienEvent` with
  `eventType` in `Repay`, `Seize`, or `BuyLocked` — every terminal
  `LienStatus`. `Refinance` and `StartAuction` are **not** closes (the loan
  continues) and are reported as their own activity buckets, never folded
  into "closed."
- **Given** (for trending only) = `LienEvent` with `eventType: LoanOfferTaken`
  — new originations only. `Refinance` is excluded from "given" (same lien,
  not a new one).
- **Activity window** = last 24 hours, used for the activity summary, the
  trending-collections ranking, and the rate-trend comparison.
- **Risk window** = trailing 30 days, used *only* for the collection risk
  profile (default/seizure mix + time-to-close) — deliberately wider than the
  24h activity window since a meaningful repaid-vs-seized ratio needs more
  than a day of closes to not be noise.
- **Not computed here on purpose: LTV / floor price.** Resolving floor price
  for every collection with an open loan (not just a top-N cut) would mean
  dozens-to-hundreds of CoinGecko calls per run. Deferred to a future
  wallet-merge feature, which only needs floor price for the collections a
  given wallet actually holds — see `DERIVATION.md`'s note on this.

## Configuration

- **Endpoint:** same Studio query URL used by `blend-active-loans` — check
  memory first for a saved endpoint (`reference` memory) before asking the
  user. Never write it into a file inside this repo.
- **RPC for on-chain fallback name lookups:** any public Ethereum mainnet
  JSON-RPC endpoint (e.g. `https://ethereum.publicnode.com`). No API key
  needed.
- **Collection name:** CoinGecko's NFT-by-contract endpoint
  (`api.coingecko.com/api/v3/nfts/ethereum/contract/<address>`), same primary
  source `blend-active-loans` uses. No floor price/LTV needed here, so only
  the `name` field matters.
- **Dashboard artifact URL:** check memory first for a saved artifact URL
  (`reference` memory, e.g. `blend_market_summary_dashboard_url`) before
  publishing — this is a persistent, redeployed dashboard, not a new
  artifact per run. See step 7 for the found/not-found flow.

## Steps

**Always send a `User-Agent` header on every call to the subgraph endpoint**
(queries A, B, and C below). The Studio endpoint has been observed to reject
requests outright when curl's default `curl/<version>` User-Agent is used, or
none is set — confirmed by a real run of `blend-active-loans` that failed on
the first attempt and only succeeded after retrying with
`-H "User-Agent: Mozilla/5.0"` added. Include it from the start:

```bash
curl -s -X POST <endpoint> \
  -H "Content-Type: application/json" \
  -H "User-Agent: Mozilla/5.0" \
  --data '{"query":"..."}'
```

1. **Query A — open loans**, for the count, median, and per-collection market
   rate/depth stats:

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

   Page with `skip` until a page comes back empty. If the open-loan count
   ever approaches graph-node's 5000-row skip cap, switch to an `id_gt`
   cursor on the last-seen id instead.

2. **Query B — last-24h lien events**, for activity, trending, and the rate
   trend. First fetch the one session-wide constant this needs — current
   unix time — **once** (`date +%s`), same "fetch once, not per-loop" rule as
   `blend-active-loans` step 3. Compute `since_24h = now_unix - 86400`, then:

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
   existing `LienEvent -> Lien` relation, no schema change involved. Same
   skip/`id_gt` paging caveat as query A. Verify `lienEvents` is the correct
   auto-pluralized field name against the live endpoint the first time this
   runs.

   `lien.loanAmount`/`lien.rate` are the lien's *current* values at query
   time, not a historical snapshot as of that specific event — correct for
   `Repay`, `Seize`, `BuyLocked`, and `StartAuction` events (none of those
   handlers touch `loanAmount`/`rate`) and correct for
   `LoanOfferTaken`/`Refinance` events too **unless the same lien was
   refinanced again later in the same window**, in which case only the most
   recent of those events' printed values will be accurate — a rare edge
   case, not worth a per-event snapshot query to close.

3. **Query C — trailing-30-day closes**, for the collection risk profile
   only. Compute `since_30d = now_unix - (30 * 86400)` (reuse the same
   `now_unix` from step 2, don't refetch):

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

   `eventType_in` works here because `LienEvent.eventType` is a plain
   `String!` field in `schema.graphql` (not an enum), so graph-node's
   standard string-list filter applies. Filtering server-side to just the
   three closing event types keeps this query's row count well below query
   B's would be if it covered 30 days unfiltered. `lien.createdAtTimestamp`
   is the lien's **original** origination time (not `interestStartTimestamp`,
   which resets on refinance) — used here to measure how long the lien
   existed overall, not just its most recent terms. Same skip/`id_gt` paging
   caveat as queries A/B; this one is more likely to need multiple pages
   given the wider window.

4. **Get the live ETH/USD price once** (keyless, same endpoint
   `blend-active-loans` uses):

   ```bash
   curl -s "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd"
   ```

5. **Rank everything and resolve collection names once, for the union of all
   ranked lists.** Compute all four rankings below first, then resolve a
   display name **once per distinct collection address that appears in any
   of them** (a collection can legitimately land in more than one list —
   don't resolve it twice):

   - **Trending given** (query B): group by `lien.collection`, count
     `LoanOfferTaken` events, top 5.
   - **Trending closed** (query B): group by `lien.collection`, count
     `Repay`+`Seize`+`BuyLocked` events, top 5.
   - **Market depth** (query A): group by `collection`, count open loans,
     top 10 by count.
   - **Risk profile** (query C): group by `lien.collection`, count closed
     events in the 30d window, top 10 by count.

   Name resolution: same primary/fallback chain as `blend-active-loans` step
   2 — CoinGecko `nfts/ethereum/contract/<address>` for `name`, falling back
   to an on-chain `eth_call` to `name()` (selector `0x06fdde03`, ABI-decode
   the returned string) if CoinGecko 404s, falling back further to the raw
   collection address if both fail.

6. **One script computes everything AND prints the finished, ready-to-paste
   markdown output directly** — same latency rationale as
   `blend-active-loans` step 4: the more of the output that comes verbatim
   out of a deterministic script instead of being independently narrated
   afterward, the faster and more reliably correct the result. After this
   script runs, the agent's job is to paste its output (at most a one-line
   intro), not re-derive or re-describe what it already printed.

   Computations, using queries A/B/C's full result sets (all pages, not a
   sample):

   ```
   # Open loans (query A)
   open_count        = len(query A results)
   active_count      = count where status == ACTIVE
   auction_count     = count where status == IN_AUCTION
   loan_values_eth    = sorted([loanAmount / 1e18 for each open loan])
   median_eth         = middle value of loan_values_eth
                         (average the two middle values if open_count is even)
   median_usd         = median_eth * eth_usd_price
   market_median_apy  = median(rate / 100 for every open loan)   # market-wide baseline

   # Per-collection market rate + depth (query A, grouped by collection)
   open_count_by_collection   = count of open loans per collection
   eth_locked_by_collection   = sum(loanAmount / 1e18) per collection
   median_apy_by_collection   = median(rate / 100) per collection
   min_apy_by_collection      = min(rate / 100) per collection
   max_apy_by_collection      = max(rate / 100) per collection
   top10_by_depth             = open_count_by_collection sorted desc, top 10

   # Activity, last 24h (query B, grouped by eventType) —
   # count AND total ETH (sum of lien.loanAmount / 1e18) per bucket
   new_loans_count,       new_loans_eth        = events where eventType == LoanOfferTaken
   repaid_count,          repaid_eth           = events where eventType == Repay
   seized_count,          seized_eth           = events where eventType == Seize
   sold_locked_count,     sold_locked_eth      = events where eventType == BuyLocked
   closed_total_count    = repaid_count + seized_count + sold_locked_count
   closed_total_eth      = repaid_eth + seized_eth + sold_locked_eth
   refinanced_count,      refinanced_eth       = events where eventType == Refinance
   entered_auction_count, entered_auction_eth  = events where eventType == StartAuction

   # 24h rate trend (query B's LoanOfferTaken events vs. query A's open-loan baseline)
   median_apy_given_24h        = median(rate / 100 for LoanOfferTaken events in query B)
                                  # "N/A — no loans given in the window" if zero
   market_apy_trend_delta      = median_apy_given_24h - market_median_apy
   median_apy_given_24h_by_collection = same, grouped by lien.collection
                                         # only for collections with >=1 given event

   # Trending, last 24h (query B, grouped by lien.collection)
   given_by_collection      = count of LoanOfferTaken events per collection
   given_eth_by_collection  = sum of lien.loanAmount / 1e18 for those same
                               LoanOfferTaken events, per collection
   avg_given_size_eth_by_collection = given_eth_by_collection / given_by_collection
   closed_by_collection     = count of (Repay + Seize + BuyLocked) events per collection
   top5_given                = given_by_collection sorted desc, top 5
   top5_closed                = closed_by_collection sorted desc, top 5

   # Collection risk profile, trailing 30d (query C, grouped by lien.collection)
   closed_30d_by_collection     = count of closing events per collection
   repay_30d_by_collection      = count(Repay) per collection
   seize_30d_by_collection      = count(Seize) per collection
   sold_locked_30d_by_collection = count(BuyLocked) per collection
   repay_rate_pct_by_collection  = repay_30d / closed_30d * 100
   seize_rate_pct_by_collection  = seize_30d / closed_30d * 100
   sold_locked_rate_pct_by_collection = sold_locked_30d / closed_30d * 100
   avg_time_to_close_days_by_collection =
       mean((event.timestamp - lien.createdAtTimestamp) / 86400)
       over that collection's 30d closed events
   top10_by_30d_closes = closed_30d_by_collection sorted desc, top 10

   # Market-wide risk headline (query C, aggregated across ALL collections,
   # not just the printed top 10 — same "totals from the full set" rule as
   # blend-active-loans)
   market_closed_30d          = sum(closed_30d_by_collection)
   market_repay_rate_pct      = sum(repay_30d_by_collection) / market_closed_30d * 100
   market_seize_rate_pct      = sum(seize_30d_by_collection) / market_closed_30d * 100
   market_sold_locked_rate_pct = sum(sold_locked_30d_by_collection) / market_closed_30d * 100
   market_avg_time_to_close_days = mean over every query C closed event, not per-collection
   ```

   Output structure, in this order:
   - **Header** with the as-of timestamp (local time, current time from step
     2's `now_unix`).
   - **Open Loans** — `open_count` (broken out `active_count` /
     `auction_count`), `median_eth` (+ `median_usd`), `market_median_apy`.
   - **Market Rates by Collection** — table of `top10_by_depth`: Collection,
     Open Loans, ETH Locked, Median APY, Min–Max APY. State the total number
     of distinct collections with an open loan, since this table is a
     depth-ranked slice, not the full set.
   - **Activity (last 24h)** — a small table with a **Count** and **Total
     ETH** column for each row: New Loans, Repaid, Seized, Sold-Locked,
     **Closed (total)**, Refinanced, Entered Auction. Follow immediately with
     the rate-trend line: `median_apy_given_24h` vs. `market_median_apy`
     (with the delta, or "N/A" if no loans were given in the window).
   - **Trending Collections (last 24h)** — two small tables: top 5 by loans
     given (collection name, count, average loan size in ETH — computed from
     the same `given` events' `loanAmount`s, not the collection's full
     open-loan book — and that collection's `median_apy_given_24h` if it has
     one) and top 5 by loans closed (collection name, count). If a metric has
     zero events in the window, say so explicitly rather than printing an
     empty table.
   - **Collection Risk Profile (trailing 30 days)** — lead with the
     market-wide headline line (`market_closed_30d` closes: repaid/seized/
     sold-locked % split, `market_avg_time_to_close_days`), then the
     `top10_by_30d_closes` table: Collection, Closed Loans, Repaid %,
     Seized %, Sold-Locked %, Avg Time to Close (days). State the total
     distinct collections represented in the 30d window, same "this is a
     ranked slice" framing as the depth table.

7. **Publish the two-chart dashboard artifact**, reusing the exact same
   `top10_by_depth` / `top10_by_30d_closes` data (and resolved names) from
   steps 5-6 — no new queries or lookups needed for this step.

   **This only means designing from scratch on the very first publish.** On
   every later run (the "Found" branch below), read the existing artifact
   and patch its embedded data in place — the chart datasets (two small
   arrays), the four stat-tile values, and the as-of timestamp — reusing its
   existing HTML/CSS/JS structure verbatim. Don't invoke `dataviz` or
   `artifact-design` or redesign anything on a redeploy; that's how the
   dashboard stays visually stable across runs instead of drifting.

   **First publish only** — before writing any chart or artifact code,
   invoke the `dataviz` skill (via the `Skill` tool) for chart/color
   guidance and the `artifact-design` skill for artifact fundamentals, both
   required loads before writing chart code or publishing an artifact for
   the first time.

   - **Chart 1 — Market Rate by Collection.** Bar chart, one bar per
     collection in `top10_by_depth`. X = collection name, Y =
     `median_apy_by_collection` (%). Include `open_count_by_collection` and
     `eth_locked_by_collection` in each bar's tooltip/label for context.
   - **Chart 2 — Rate vs. Risk by Collection.** Scatter/bubble chart. X =
     `median_apy_by_collection` (%), Y = `seize_rate_pct_by_collection` (30d,
     %), bubble radius scaled by `open_count_by_collection`. Only plot
     collections that have **both** metrics — i.e. the intersection of
     `top10_by_depth` and `top10_by_30d_closes` (both already name-resolved
     in step 5, so this needs no extra API calls). If that intersection has
     fewer than 3 collections, say so plainly instead of forcing a
     near-empty chart — don't expand the lookup scope to fill it in.

   Both charts go on one published HTML artifact (two panels, one page).

   **This is a persistent, redeployed dashboard, not a new artifact per
   run** — check memory first for a saved artifact URL (`reference` memory,
   e.g. `blend_market_summary_dashboard_url`):
   - **Found:** read it (`action: "read"`) to get the current published
     version, then republish to that same `url` after patching in the
     freshly computed data — the `chart1`/`chart2` arrays, the
     `marketMedianApy`/`marketSeizeRate` reference-line values, the four
     stat-tile numbers, and `now_unix`, all inline in the page's `<script>` —
     leaving everything else (markup, CSS, layout) untouched. The link stays
     the same across every invocation, always showing the latest run.
   - **Not found:** publish a new artifact, then save its URL as a
     `reference` memory so future runs reuse it instead of creating a new
     link each time.

   Pick a title and favicon once on first publish (e.g. "Blend Market
   Pulse", 📊) and never change them on later redeploys — per the Artifact
   tool's own convention, a changed favicon/title reads as a different page
   to a viewer who bookmarked the link.

   Share the artifact link alongside the pasted markdown from step 6 — the
   charts are the artifact, don't also try to render them as ASCII/text.

## Notes

- `loanAmount` is in wei; `rate` is in basis points (`rate / 100` = APY %) —
  same conversions as `blend-active-loans`, never display either raw.
- Median, ETH/USD price, and every rate/depth/risk stat here are live,
  recompute-every-time numbers — don't cache or reuse values across
  invocations.
- If a collection in one of the four ranked lists 404s from CoinGecko and its
  on-chain `name()` fallback also fails (reverts, empty, or a non-string
  return type), fall back to showing the raw collection address rather than
  dropping it from the ranking.
- All three queries reuse the same `now_unix` fetched once in step 2, and the
  same live ETH/USD price fetched once in step 4 — don't refetch either
  mid-computation.
- The 30-day risk profile is a **closed-loan** metric — a collection with a
  high `seize_rate_pct` had a rough trailing month for lenders who didn't get
  repaid or refinanced out in time; it says nothing directly about currently
  open loans' health (that's what LTV would show, deferred per the
  Definitions section above).
- The dashboard artifact (step 7) redeploys to the same URL every run —
  don't publish a fresh artifact each invocation once one exists in memory,
  that would leave stale, orphaned links behind.
