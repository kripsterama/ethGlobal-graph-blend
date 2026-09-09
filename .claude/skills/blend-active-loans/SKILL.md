---
name: blend-active-loans
description: >-
  Query the Blend subgraph for currently open loans (ACTIVE and IN_AUCTION —
  a loan a lender has moved to exit isn't closed until repaid, refinanced,
  or seized) and enrich them with computed APY, ETH/USD amounts, accrued
  gains, monthly/annual gain forecasts, LTV% (via NFT floor price), auction
  countdown status, and collection names, plus portfolio-wide totals.
  Optionally filter to a single lender wallet address and/or a single NFT
  collection. Use when the user asks about active/open Blend loans, e.g.
  "show me open loans", "what loans are currently active", "list active
  Blend positions", "show active loans for lender 0x...", "active loans
  against BAYC", "what are my projected monthly/annual gains", "what's the
  LTV on these loans", "what's the status of my auctions", "which loans have
  I closed positions on that haven't resolved yet".
---

# Blend Active Loans

Fetches `ACTIVE` and `IN_AUCTION` `Lien`s from the Blend subgraph — both are
"open" from a lender's perspective, a loan a lender has exited via
`startAuction` isn't actually closed until the borrower repays, a new lender
refinances them out, or the auction window fully elapses and the lender
seizes — and enriches the raw on-chain fields with values the subgraph
deliberately does not store (collection name, floor price/LTV, human units,
USD pricing, and time-dependent interest math). See `blend/USE_CASES.md`
(UC1: all active loans; UC2: active loans for one lender; UC3: gains in USD
+ monthly/annual forecasts + portfolio totals; UC4: LTV% via floor price;
UC5: in-auction loans + status/countdown) for the full derivation and
reasoning behind these formulas — this skill just executes those use cases
end to end.

**Collection name and NFT token ID are always shown, immediately after
Lien ID, for every loan row — never drop them for space.**

## Filtering (optional)

If the invocation's args mention a lender address and/or a collection
address, narrow the query to just those instead of returning everything:

- **Lender** — add `lender: "<address>"` to the `where` clause. `Account.id`
  is stored as a lowercase hex string, so **lowercase the address** before
  filtering, regardless of the casing the user typed it in.
- **Collection** — add `collection: "<address>"` to the `where` clause.
  Same rule: lowercase it first (`Bytes` fields are stored/returned
  lowercase, as seen when querying by BAYC's address).
- Both can be combined (e.g. "lender X's active BAYC loans") — just add both
  keys to the same `where` object alongside `status_in: [ACTIVE, IN_AUCTION]`.
- If the user names a collection by ticker/name (e.g. "BAYC") rather than by
  address, resolve the address first (either from prior context in the
  conversation, or by asking) rather than guessing.

## Configuration

- **Endpoint:** not hardcoded here on purpose — the Studio query URL embeds a
  subgraph ID and is a live query surface, so it shouldn't sit in a public
  repo. Check memory first for a saved endpoint for this project; if none is
  found, ask the user for it and save it to memory afterward (as a
  `reference` memory) so future invocations don't need to ask again. Never
  write the endpoint into a file inside this repo.
- **RPC for on-chain fallback name lookups:** any public Ethereum mainnet
  JSON-RPC endpoint works (e.g. `https://ethereum.publicnode.com`). No API
  key needed.
- **Collection name + floor price:** CoinGecko's NFT-by-contract endpoint
  (`api.coingecko.com/api/v3/nfts/ethereum/contract/<address>`) is keyless
  and returns both in one call, which is why it's the primary source (see
  step 2) rather than the on-chain `name()` call used in earlier iterations
  of this skill.

## Steps

1. **Query open loans.** POST this to the endpoint above. `where` starts
   with `status_in: [ACTIVE, IN_AUCTION]` — both are "open" (see intro); add
   `lender`/`collection` keys per the Filtering section above if the
   invocation asked for them:

   ```graphql
   query OpenLoans {
     liens(
       first: 100
       where: { status_in: [ACTIVE, IN_AUCTION] }
       orderBy: createdAtTimestamp
       orderDirection: desc
     ) {
       id
       status
       collection
       tokenId
       loanAmount
       rate
       auctionStartBlock
       auctionDuration
       createdAtTimestamp
       interestStartTimestamp
       lender {
         id
       }
     }
   }
   ```

   ```bash
   curl -s -X POST <endpoint> \
     -H "Content-Type: application/json" \
     --data '{"query":"..."}'
   ```

   If there are more than 100 active loans, page through with `skip` (or
   `id_gt` on the last-seen id) until a page comes back empty.

2. **Resolve collection name + floor price, once per collection.** Collect
   the distinct `collection` addresses from the results — dedupe first, this
   lookup happens **once per unique collection, not once per loan**, since
   multiple loans commonly share a collection. Before making any of these
   calls, count the distinct addresses and make exactly that many calls —
   if the number of CoinGecko/RPC calls made in this step doesn't match the
   distinct-collection count, that's the same class of performance bug as
   the timezone one in step 3 (an operation that should run once per unique
   value instead running once per loan):

   ```bash
   curl -s "https://api.coingecko.com/api/v3/nfts/ethereum/contract/<collection_address>"
   ```

   - On success: use its `name` field for display, and `floor_price.native_currency`
     (ETH) for the LTV calculation in step 4.
   - On a 404 (`{"error": "nft collection not found"}` — happens for smaller/
     unlisted collections CoinGecko doesn't track): fall back to reading the
     name directly from the contract via `eth_call` to `name()` (function
     selector `0x06fdde03`, no args) against the RPC endpoint, ABI-decode the
     returned string (offset + length + UTF-8 bytes, padded to 32 bytes —
     decode with a short script, don't eyeball the hex), and mark floor
     price/LTV as **N/A** for every loan in that collection rather than
     guessing or omitting the row.

3. **Get everything that's a one-time, session-wide constant: current time,
   local timezone, ETH/USD price, and (if any loan is `IN_AUCTION`) the
   current block number.** None of these vary per loan — fetch/detect each
   exactly **once here**, not inside the per-loan loop in step 4. This
   includes the local timezone used for `issued_at` in step 4: detect it
   once now (e.g. `date +%Z`, or Python's `datetime.now().astimezone().tzinfo`)
   and reuse that single value for every loan's timestamp conversion. Doing
   this per-loan instead of once is a real, measured performance bug in
   earlier runs of this skill — ~19 loans took ~3 minutes, dominated by
   redundant timezone-detection calls repeated once per loan instead of once
   total.

   Time: `date +%s`. Price, keyless:

   ```bash
   curl -s "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd"
   ```

   Current block, needed for the auction countdown in step 4, also keyless:

   ```bash
   curl -s -X POST https://ethereum.publicnode.com -H "Content-Type: application/json" \
     --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'
   # result is hex — convert to decimal before using
   ```

4. **One script computes every loan's fields AND prints the finished,
   ready-to-paste markdown output directly** — the table, the totals
   section, and the notable-conditions callouts (high LTV, in-auction,
   excluded outliers) all as plain text the script writes to stdout. This is
   the single biggest lever on this skill's latency: LLM generation time
   scales with how much text the *model* has to compose, so the more of the
   table/flag/totals text that comes verbatim out of a deterministic script
   instead of being independently reasoned about and narrated afterward, the
   faster and more reliably correct the result. After this script runs, the
   agent's job is to paste its output (with at most a one-line intro), not
   to re-derive or re-describe what it already printed. It also structurally
   fixes a recurring bug in earlier versions of this skill (columns like
   Collection/tokenId/Lender silently dropped across iterations) — a
   deterministic script that always builds the same column list every time
   can't "forget" a column the way reconstructing a table from memory could.

   Column order, fixed: Lien ID, **Collection (name) + NFT token ID** (right
   after Lien ID — never drop for space), Loan Amount (ETH), **LTV %** (right
   after loan amount), APY %, **Status**, Gains to Date (ETH/USD), Monthly
   Forecast (ETH/USD), Annual Forecast (ETH/USD), Lender address, Issued
   (date/time).

   Per-loan math the script performs, using `interestStartTimestamp` (not
   `createdAtTimestamp` — they diverge after a refinance) as the accrual
   basis, and the timezone/price/block values fetched once in step 3 (not
   re-fetched here):

   ```
   loan_eth       = loanAmount / 1e18
   apy_pct        = rate / 100                          # e.g. 1300 bips -> 13.00%
   ltv_pct        = (loan_eth / collection_floor_eth) * 100     # N/A if no floor price
   years_elapsed  = (now_unix - interestStartTimestamp) / (365 * 86400)
   gains_to_date_eth = loan_eth * (e^(rate/10000 * years_elapsed) - 1)
   monthly_eth    = loan_eth * (e^(rate/10000 * (1/12)) - 1)
   annual_eth     = loan_eth * (e^(rate/10000) - 1)          # forward-looking: what next
                                                              # year would accrue at current
                                                              # terms, not a historical figure
   gains_to_date_usd = gains_to_date_eth * eth_usd_price
   monthly_usd       = monthly_eth * eth_usd_price
   annual_usd        = annual_eth * eth_usd_price
   issued_at      = createdAtTimestamp converted using the local timezone from step 3
   ```

   `rate` is itself the quoted annual rate (bips -> percent is a direct
   divide, never an exponential transform) even though debt/gains growth
   over time *is* continuously compounded — confirmed against the actual
   Blend contract source, `Helpers.computeCurrentDebt`. `ltv_pct` uses the
   NFT's *collection* floor as a stand-in for that exact token's value (the
   practical, available metric, not the original loan offer's oracle price,
   which isn't retrievable after the fact). Do this arithmetic with a real
   calculator (Python's `math.exp`, not mental math) — the exponential is
   easy to get meaningfully wrong by hand, especially at higher rates.

   `Status`, for `IN_AUCTION` loans — don't skip these just because they're
   not `ACTIVE`; a lender exiting via `startAuction` starts a race (borrower
   repays, or a new lender refinances them out, or the window elapses and
   the original lender can `seize`), not a close. All the financial columns
   above still apply unchanged during an auction (contract source confirms
   `startAuction` leaves `lien.startTime` untouched, so interest keeps
   accruing on the original terms):

   ```
   deadline_block    = auctionStartBlock + auctionDuration
   remaining_blocks  = deadline_block - current_block          # current_block from step 3
   remaining_hours   = remaining_blocks * 12 / 3600             # ~12 sec/block, post-merge

   status:
     ACTIVE                             -> "ACTIVE"
     IN_AUCTION, remaining_blocks > 0   -> "AUCTION — {remaining_hours}h remaining"
     IN_AUCTION, remaining_blocks <= 0  -> "AUCTION — window elapsed, seizable now"
   ```

   **`auctionDuration` is a block count, not seconds** — confirmed against
   the contract source (`Helpers.calcRefinancingAuctionRate` computes its
   rate curve explicitly "per block") and empirically (a real lien's
   `auctionDuration: 9000` matched a lender-described "30 hour window"
   exactly at ~12 sec/block: `9000 * 12 / 3600 = 30`). Treating it as
   seconds would be wrong by a factor of ~300.

   **Totals, computed by the same script, from the full result set** (not
   just a printed sample — see below): sum of gains-to-date, monthly
   forecast, and annual forecast, each in both ETH and USD. The totals
   section always leads with a number that makes sense totalled — never a
   sum dominated by one pathological outlier. Blend's refinancing-auction
   rate can spike as high as 100,000 bips (1000% APY) near liquidation, and
   continuous compounding turns that into an absurd single-loan annual
   figure (a real 0.3 ETH loan at 999% APY projects to ~6,500 ETH/year) that
   no loan actually survives to see. So: any loan with `apy_pct` > 100 is
   excluded from the primary annual total by default, and the script prints
   it separately with its own individual annual figure — never silently
   folded into the headline sum. Gains-to-date and monthly figures don't
   need this treatment; they stay small even at extreme rates over short
   spans.

   **Large result sets:** if there are more matching loans than reasonable
   to print (rule of thumb: ~20+), the script prints a representative
   sample (e.g. the N largest by loan size) rather than every row, but
   states the total count and what the sample was limited by — never a
   silent truncation — while still computing totals from the *entire*
   result set. Any `IN_AUCTION` loan gets called out by name in the script's
   printed output too, not just as a table row — it's a live, time-sensitive
   decision point for the lender.

## Notes

- `rate` is in basis points; `loanAmount` is in wei. Never display either
  raw without converting.
- APY is fixed for the life of the current loan terms (it only changes on a
  `Refinance`) — don't imply it fluctuates.
- Gains-to-date, the ETH/USD price, and floor prices are all live,
  recompute-every-time numbers — don't cache or reuse previously computed
  values across invocations (per-collection dedupe *within* a single
  invocation is fine and expected, that's not the same thing).
- If a collection's CoinGecko lookup 404s and its on-chain `name()` fallback
  also reverts or returns empty (some contracts don't implement it, or use
  `bytes32` instead of `string`), fall back further to showing the raw
  collection address instead of failing the whole query. LTV stays N/A in
  this case too, same as the CoinGecko-404-only case.
- `tokenId` is always the raw ERC-721 token ID (verified correct against raw
  on-chain `Transfer` logs, independent of this subgraph). Some collections
  — confirmed for CloneX — brand NFTs with a separate "display number" that
  differs from the actual token ID for the same NFT, so a loan's shown
  tokenId may not match what a collection's own marketplace/dashboard
  displays for it. This is not a bug; don't silently "fix" it by guessing a
  different number, and mention the distinction if a user flags a mismatch
  against another source (see `blend/USE_CASES.md` UC1 for the full
  writeup).
