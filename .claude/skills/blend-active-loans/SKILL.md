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

   Current block, needed for the auction countdown in step 4a, also keyless:

   ```bash
   curl -s -X POST https://ethereum.publicnode.com -H "Content-Type: application/json" \
     --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'
   # result is hex — convert to decimal before using
   ```

4. **Compute the derived fields for all N loans in a single script
   execution** (one Python/Node/etc. call that loops over every loan and
   prints the finished rows), not N separate tool calls. This is the same
   fix as step 3's timezone note, generalized: anything that's the same
   operation repeated per loan belongs in one batched call, not one call per
   loan — each extra tool-call round trip costs real wall-clock time
   (sandbox overhead, model turnaround) far beyond the trivial arithmetic
   itself, and is the actual reason a 19-loan run took ~3 minutes rather
   than a few seconds.

   Using `interestStartTimestamp` (not `createdAtTimestamp` — they diverge
   after a refinance) as the accrual basis. `rate` (bips) is itself the
   quoted annual rate — convert directly to a percent, don't run it through
   an exponential transform. Debt/gains growth over time, however, *is*
   continuously compounded (confirmed against the actual Blend contract
   source, `Helpers.computeCurrentDebt`). Monthly/annual figures are
   **forward-looking projections** — the interest that would accrue over the
   *next* month/year if the loan's current principal and rate held constant
   for that whole period, not a historical figure. `issued_at` uses the
   local timezone detected once in step 3 — don't re-detect it here:

   ```
   loan_eth       = loanAmount / 1e18
   apy_pct        = rate / 100                          # e.g. 1300 bips -> 13.00%
   ltv_pct        = (loan_eth / collection_floor_eth) * 100     # N/A if no floor price
   years_elapsed  = (now_unix - interestStartTimestamp) / (365 * 86400)
   gains_to_date_eth = loan_eth * (e^(rate/10000 * years_elapsed) - 1)
   monthly_eth    = loan_eth * (e^(rate/10000 * (1/12)) - 1)
   annual_eth     = loan_eth * (e^(rate/10000) - 1)

   gains_to_date_usd = gains_to_date_eth * eth_usd_price
   monthly_usd       = monthly_eth * eth_usd_price
   annual_usd        = annual_eth * eth_usd_price

   issued_at      = createdAtTimestamp converted using the local timezone
                    already detected once in step 3 (don't re-detect it
                    per loan, and don't assume UTC or hardcode a zone)
   ```

   `ltv_pct` uses the specific NFT's *collection* floor as a stand-in for
   that exact token's value (the practical, available metric — not what the
   original loan offer's oracle price was, which isn't retrievable after the
   fact). A high LTV (loan close to or above current floor) signals a
   position that's underwater or close to it; worth calling out in prose if
   any loan's LTV is notably high (e.g. > 80-90%), not just leaving it as a
   number in the table.

   Do this arithmetic with a real calculator (e.g. `python3 -c "import math; ..."`)
   rather than approximating by hand — the exponential is easy to get
   meaningfully wrong via mental math, especially at higher rates.

4a. **For `IN_AUCTION` loans, compute a status/countdown, and don't skip
   them just because they're not `ACTIVE`.** A lender exits a position via
   `startAuction`, which starts a race, not a close: the borrower can repay,
   a new lender can refinance them out, or — only once the window fully
   elapses with neither happening — the original lender can `seize` the
   collateral. All the financial columns (LTV, APY, gains, monthly/annual)
   still apply unchanged; interest keeps accruing on the original terms
   during an auction (confirmed in source — `startAuction` carries
   `lien.startTime` through unchanged).

   **`auctionDuration` is a block count, not seconds** — confirmed against
   the contract source (`Helpers.calcRefinancingAuctionRate` computes its
   rate curve explicitly "per block," comparing `block.number - startBlock`
   against fractions of `auctionDuration`) and empirically (a real lien's
   `auctionDuration: 9000` matches a lender-described "30 hour window"
   exactly at ~12 sec/block: `9000 * 12 / 3600 = 30`). Treating it as
   seconds would be wrong by a factor of ~300.

   ```
   deadline_block    = auctionStartBlock + auctionDuration
   remaining_blocks  = deadline_block - current_block
   remaining_hours   = remaining_blocks * 12 / 3600     # ~12 sec/block, post-merge

   status_display:
     remaining_blocks > 0  -> "AUCTION — {remaining_hours}h remaining"
     remaining_blocks <= 0 -> "AUCTION — window elapsed, seizable now"
   ```

5. **Watch for extreme-rate outliers before presenting an annual total.**
   Blend's refinancing-auction rate can spike as high as 100,000 bips
   (1000% APY) as a loan nears liquidation with no refinancer. Continuous
   compounding turns that into an absurd-looking annual figure for a single
   small loan (e.g. a 0.3 ETH loan at 999% APY projects to ~6,500 ETH/year)
   that no real loan will actually survive to see, since it'd get
   refinanced/repaid/seized long before a year passes at that rate. This
   does not apply to gains-to-date or monthly figures, which stay small even
   at extreme rates over short spans — only annual needs this treatment.

   **The Totals row/section always leads with numbers that make sense
   totalled** — never a sum dominated by one pathological outlier such that
   the total doesn't represent the portfolio. If any loan's `apy_pct` is
   unrealistically high (rule of thumb: > 100%), exclude it from the primary
   annual total by default, and list it separately with its own individual
   annual figure right next to (not buried below) the totals section — don't
   present the outlier-inflated sum as the headline number with the sane one
   as an afterthought.

6. **Present as a table**, one row per loan, columns in this order: Lien ID,
   **Collection (name) + NFT token ID** (always, right after Lien ID — never
   drop these for space), Loan Amount (ETH), **LTV %** (right after loan
   amount), APY %, **Status** (`ACTIVE`, or the auction countdown string
   from step 4a), Gains to Date (ETH/USD), Monthly Forecast (ETH/USD),
   Annual Forecast (ETH/USD), Lender address, Issued (date/time). If there
   are more matching loans than are reasonable to print (rule of thumb:
   ~20+), show a representative sample (e.g. the N largest by loan size)
   rather than every row — but say so explicitly (total count, what the
   sample was sorted/limited by) rather than quietly truncating, and compute
   the **totals section from the full result set**, not just the printed
   sample. If any loan is `IN_AUCTION`, call it out in prose too (not just
   in the table), since it's an active, time-sensitive decision point for
   the lender — don't let it blend in as just another row.

7. **Add a totals row/section**: sum of gains-to-date, monthly forecast, and
   annual forecast, each in both ETH and USD, across every matching loan,
   applying step 5's outlier exclusion to the annual total by default (state
   how many loans were excluded and why, and list them individually).

8. **Before sending the table, count its columns against step 6's list.**
   This skill has repeatedly grown new required columns (LTV%, USD, monthly/
   annual, then had Lender silently dropped in one pass even after being
   established) — that happened from reconstructing the output by memory
   instead of checking it against this spec. Literally verify, per column
   in step 6's ordered list, that it's present in the table about to be
   shown. Missing one is a correctness bug in this skill's output, not a
   trivial formatting choice.

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
