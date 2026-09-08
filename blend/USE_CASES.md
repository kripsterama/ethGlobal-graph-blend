# Blend Subgraph — Query Use Cases

This file tracks the queries the app needs to run once the subgraph is synced, and
verifies that `schema.graphql` + `src/blend.ts` actually capture what each query needs.
Each use case lists: the fields required, the query, any values that must be derived
client-side (not stored in the subgraph), and any known gaps.

---

## UC1: Currently active loans

**Ask:** list loans that are currently active (not repaid, seized, sold, or in auction).
For each: the NFT (collection + tokenId), loan amount in ETH, APY %, gains to date in
ETH, lender's wallet address, and the date/time the loan was issued.

### Query

```graphql
query ActiveLoans {
  liens(where: { status: ACTIVE }, orderBy: createdAtTimestamp, orderDirection: desc) {
    id
    collection
    tokenId
    loanAmount
    rate
    createdAtTimestamp
    interestStartTimestamp
    lender {
      id
    }
  }
}
```

- `collection` + `tokenId` → the NFT. Collection name/metadata is not stored on-chain
  here and should be fetched at runtime from elsewhere (e.g. an NFT metadata API),
  as intended.
- `lender.id` → the lender's wallet address (this is how `Account.id` is stored —
  lowercase hex string of the address).
- `createdAtTimestamp` → the date/time the loan was originally issued (unix seconds).

**Known quirk — `tokenId` is the raw ERC-721 token ID, which isn't always the
number a collection is branded by.** A lender flagged that our CloneX token IDs
didn't match Blend's own dashboard for the same loans. Verified independently
(raw on-chain `Transfer` log for lien `440903`: token ID `9357`, matching our
subgraph exactly) that our data is correct — the on-chain event and every
transfer only ever carry the true ERC-721 `tokenId`, which is what we store.
CloneX specifically has a *second*, separate "display number" branded to
collectors that differs from the contract token ID for the same NFT (confirmed
via Etherscan: the same token appears as both `/nft/.../15861` in the URL and
"CloneX #7878" in the page title — Blend's dashboard evidently shows this
display number). Resolving it would need a **per-token** metadata lookup
(`tokenURI(tokenId)`, not a once-per-collection call like floor price), and
CloneX's metadata hosting has had prior outages (a 2025 Cloudflare incident took
its images/metadata offline temporarily) — a reliability risk the raw on-chain
token ID never has. Decision: keep showing the raw token ID and document this
rather than add per-token metadata resolution for now.

### Derived client-side (not stored — computed at query/render time)

Confirmed against the actual Blend contract source (`Helpers.computeCurrentDebt`,
verified on Blockscout): interest is **continuously compounded**, not simple/linear.

```
debt(t) = loanAmount * e^(rate/10000 * years_elapsed)
```

- **APY %** — fixed for the life of the loan (it's a loan term the lender accepted
  when making the offer; it only changes if the loan is refinanced to a new rate).
  `rate` (bips) *is* the quoted annual rate — convert directly, don't run it
  through an exponential transform (verified against real data: a lien with
  `rate = 1300` is quoted as 13.00% APY, not `(e^0.13 - 1)*100 ≈ 13.88%`):

  ```
  APY% = rate / 100
  ```

- **Gains to date (ETH)** — *is* time-varying, since interest keeps compounding
  against that fixed rate as time passes. Recompute on every render/query using the
  current wall-clock time:

  ```
  years_elapsed = (now_unix - interestStartTimestamp) / (365 * 86400)
  gains_wei     = loanAmount * (e^(rate/10000 * years_elapsed) - 1)
  ```

- **Unit conversions** — `loanAmount` is in wei (divide by 1e18 for ETH); `rate` is
  in basis points (divide by 10000 for a decimal fraction).

### Resolved: `interestStartTimestamp`

`Lien.interestStartTimestamp` mirrors the contract's `lien.startTime` — set at
origination (`handleLoanOfferTaken`) and reset on every `Refinance`
(`handleRefinance`), but deliberately **not** touched by `handleStartAuction`,
matching the contract (`startAuction` carries `lien.startTime` through unchanged
when a lien enters auction — interest keeps accruing against the original terms
during the auction). This makes current-debt/gains calculations correct for
`ACTIVE` loans (this use case) and safe to reuse later for `IN_AUCTION` loans too,
without depending on `updatedAtTimestamp`, which is bumped by every handler
(including ones that don't reset the real interest clock) and so doesn't reliably
mean "when did the current terms take effect."

Covered by tests in `tests/blend.test.ts`: `handleStartAuction`'s test asserts
`interestStartTimestamp` is unchanged after an auction starts (while
`updatedAtTimestamp` does change), and `handleRefinance`'s test asserts it resets
to the refinance event's timestamp.

---

## UC2: Active loans for one lender

**Ask:** same as UC1, but scoped to a single lender's wallet address — "what active
positions does lender X currently hold."

### Query

Identical to UC1's, with `lender` added to `where`. The address must be
**lowercased** first — `Account.id` is stored as a lowercase hex string, so a
mixed-case or checksummed address won't match:

```graphql
query ActiveLoansForLender($lender: String!) {
  liens(
    where: { status: ACTIVE, lender: $lender }
    orderBy: createdAtTimestamp
    orderDirection: desc
  ) {
    id
    collection
    tokenId
    loanAmount
    rate
    createdAtTimestamp
    interestStartTimestamp
  }
}
```

(`lender` variable, e.g. `"0xfad4d20eda6d3dfe8f59899b898427594b53b228"`.)

All the same derived-value formulas from UC1 apply unchanged (APY, gains-to-date,
unit conversions) — this is the same use case with one extra `where` clause, not a
different data shape. No schema/handler changes were needed to support it: `lender`
was already a required, indexed relationship field on `Lien`.

Implemented as an optional filter in the `blend-active-loans` skill rather than as
a separate skill, since UC1 and UC2 are the same query shape differing only by
`where` clause — see that skill's "Filtering" section.

---

## UC3: Gains in USD, monthly/annual forecasts, and portfolio totals

**Ask:** for active loans (UC1/UC2), also show gains-to-date in USD alongside ETH,
projected monthly and annual gains in both ETH and USD, and a totals line
summarizing all of the above across every matching loan.

### What's new vs. UC1/UC2

No schema or query changes — same `liens` query, same fields. Everything here is
additional client-side derivation using one new external input: a live ETH/USD
price (e.g. CoinGecko's keyless `simple/price` endpoint).

### Formulas

```
eth_usd_price   = fetched live (don't cache across invocations — price moves)

# Forward-looking projections: interest that WOULD accrue over the next
# month/year if principal and rate held constant for that whole period.
# Not a historical or cumulative figure like gains-to-date.
monthly_eth = loan_eth * (e^(rate/10000 * (1/12)) - 1)
annual_eth  = loan_eth * (e^(rate/10000) - 1)

gains_to_date_usd = gains_to_date_eth * eth_usd_price
monthly_usd       = monthly_eth * eth_usd_price
annual_usd        = annual_eth * eth_usd_price
```

### Totals

Sum `gains_to_date_eth/usd`, `monthly_eth/usd`, and `annual_eth/usd` across every
loan matching the query (not just a displayed sample — see the "large result sets"
note below).

### Gotcha: extreme-rate outliers blow up the annual total

Verified against real data: with 423 active loans (unfiltered, test deployment),
two loans carry refinancing-auction rates near Blend's 100,000-bips liquidation
ceiling (999% and 522% APY). Continuous compounding over a full year turns a
0.3 ETH loan at 999% APY into a ~6,542 ETH annual projection — which dominated the
portfolio-wide annual total (6,662 ETH) even though 421 of the 423 loans totaled a
combined ~81 ETH of realistic annual forecast. No loan actually survives
unrefinanced for a year at that rate (it gets refinanced/repaid/seized long
before), so a straight sum including it is technically correct arithmetic but a
misleading number to hand someone.

Handling: the totals row/section always leads with a number that makes sense
totalled. Any loan with an unrealistically high `apy_pct` (rule of thumb: > 100%)
is excluded from the primary annual total by default and listed separately with
its own individual annual figure — not blended into a headline sum that a reader
would take as representative of the portfolio, with the sane number relegated to
a footnote. This only affects the *annual* forecast — gains-to-date and monthly
figures stay small even at extreme rates over short time spans, so they don't
need the same treatment.

### Large result sets

423 active loans is too many to print row-by-row usefully. Show a representative
sample (e.g. the N largest loans) rather than everything, but say so explicitly —
total count and what the sample was chosen by — and compute the totals section
from the *entire* matching set, not just the printed sample. Don't silently
truncate and let a partial-looking total pass as complete.

---

## UC4: LTV% via NFT floor price

**Ask:** for each active loan, show the loan-to-value ratio (loan amount vs. the
collateral NFT's current market value), right after the loan amount column.
Floor price must be looked up once per collection, not once per loan.

### Why this needs an external lookup, and which one

Floor price isn't on-chain data in any standardized way — there's no `floorPrice()`
function on an ERC-721 contract, it's a marketplace-aggregated off-chain metric.
Verified against real collections (BAYC, CloneX, Pudgy Penguins, Redacted Remilio
Babies): CoinGecko's NFT-by-contract endpoint —

```
GET https://api.coingecko.com/api/v3/nfts/ethereum/contract/<collection_address>
```

— is keyless and returns both `name` and `floor_price.native_currency` (ETH) in
one call, given just the collection's contract address (which is all we have from
the subgraph). This replaced the earlier on-chain `name()`-only lookup as the
primary source for collection name, since it's one call instead of two and its
name is sometimes more accurate than the raw on-chain value — e.g. contract
`0xd3d9ddd0cf0a5f0bfb8f7fceae075df687eaebab`'s on-chain `name()` returns
`"TEST NFT"`, while CoinGecko correctly identifies it as `"Redacted Remilio
Babies"`.

### Fallback

Smaller/unlisted collections 404 from CoinGecko (`{"error": "nft collection not
found"}`). In that case, fall back to the on-chain `name()` call for display, and
mark LTV as **N/A** for every loan in that collection — don't guess a floor price
or drop the row.

### Formula

```
ltv_pct = (loan_eth / collection_floor_eth) * 100
```

Uses the *collection's* floor as a stand-in for the specific token's value — the
practical, available metric. Not the same as the original loan offer's oracle
price (not retrievable after the fact from what the subgraph indexes).

### Caching scope

Floor price is looked up once per **unique** collection per invocation (dedupe
across loans sharing a collection — this was the whole point of the ask), but
never cached *across* invocations — floor prices move continuously, same as the
ETH/USD price in UC3.

### Worth flagging in output, not just tabulating

A loan with LTV at or above ~80-90% is a position close to or past being
underwater relative to current floor. Call these out in prose alongside the
table, not just as a number a reader might skim past.

---

## UC5: In-auction loans, shown alongside active, with status/countdown

**Ask:** a lender exits a position by calling `startAuction` — but that doesn't
close the loan. The borrower gets a window to repay, or a new lender can
refinance them out; only after the window fully elapses with neither happening
can the original lender `seize` the collateral. These loans (`status:
IN_AUCTION`) need to show up in the same view as `ACTIVE` loans, not be silently
excluded just because they're no longer `ACTIVE` — with a status indicator
showing what's actually happening (time remaining, or "seizable now").

### Query change from UC1/UC2

```graphql
where: { status_in: [ACTIVE, IN_AUCTION] }
```

`status_in` is graph-node's standard auto-generated enum-list filter — verified
against real data. All the UC1/UC3/UC4 derived-value formulas (APY, gains,
monthly/annual, LTV) apply unchanged to `IN_AUCTION` loans: the contract leaves
`lien.startTime`/`amount`/`rate` untouched when an auction starts (same fact
`interestStartTimestamp` was built around — see UC1's "Resolved" section), so
interest keeps accruing on the original terms throughout the auction.

### Gotcha, confirmed against the real contract source AND a real user report

`Lien.auctionDuration` is a **block count, not seconds**. Found because a real
example didn't add up: a lender reported a specific position had "a 30 hour
window" to resolve, but the stored `auctionDuration` was `9000` — which is 2.5
hours if read as seconds. Checking `Helpers.calcRefinancingAuctionRate` in the
verified contract source confirms it: the auction rate curve is computed
explicitly "per block" (`block.number - startBlock` compared against fractions
of `auctionDuration`, with slopes commented "wad-bips per block"). At Ethereum's
~12-second post-merge block time, `9000 blocks * 12s = 108,000s = exactly 30
hours` — matching the report precisely. Treating this field as seconds anywhere
(a countdown, a "time remaining" display) would be wrong by a factor of ~300.

### Status/countdown formula

```
deadline_block   = auctionStartBlock + auctionDuration
remaining_blocks = deadline_block - current_block          # current_block via any RPC
remaining_hours  = remaining_blocks * 12 / 3600

status:
  ACTIVE                                    -> "ACTIVE"
  IN_AUCTION, remaining_blocks > 0          -> "AUCTION — {remaining_hours}h remaining"
  IN_AUCTION, remaining_blocks <= 0         -> "AUCTION — window elapsed, seizable now"
```

### Display

Add a `Status` column to the table (per-loan), and call out any `IN_AUCTION`
loan in prose alongside the table — it's a live, time-sensitive decision point
for the lender (repay incoming? refinance incoming? about to become seizable?),
not just another row to skim past.

---

## UC6: Querying loan offers (not just taken loans) — not indexable, and no API found either

**Ask:** query loan offers, not just liens that resulted from a taken offer.

### Why the subgraph structurally can't do this

Confirmed against the actual contract source (`OfferController.sol`). Offers are
off-chain EIP-712 signed messages — they never touch chain state until (and
unless) something happens to them:

```solidity
function _validateOffer(...) internal view {
    _verifyOfferAuthorization(offerHash, signer, oracle, signature);  // pure signature check
    if (expirationTime < block.timestamp) revert OfferExpired();
    if (cancelledOrFulfilled[signer][salt] == 1) revert OfferUnavailable();
}
```

There is no `offers` mapping or array anywhere in the contract storing offer
terms. The only three on-chain traces related to offers, all confirmed in the
ABI:

- **`LoanOfferTaken`** — an offer was fulfilled. Already fully indexed (this
  is how every `Lien` in this subgraph comes to exist).
- **`OfferCancelled(user, salt)`** — one specific offer was explicitly killed.
  Not indexed. Carries no offer terms, just enough to invalidate a future
  signature check.
- **`NonceIncremented(user, newNonce)`** — a lender bulk-invalidated *every*
  offer they'd ever signed. Not indexed. Also carries no offer terms.

A subgraph can only ever see what happened on-chain — since a live,
not-yet-taken offer has no on-chain footprint at all, there is no schema or
mapping change that could make it queryable here. This isn't a missing
feature; it's outside what any on-chain indexer can do for this contract.

### Checked whether Blur exposes this off-chain — they don't, at least not publicly

Searched for an official Blur/Blend API that might expose the live offer
orderbook directly (bypassing the on-chain-only limitation above). Consistent
finding across multiple searches: **Blur does not publish an official public
developer API or SDK**, for the marketplace or for Blend specifically. One
explainer source independently describes Blend's matching as using "a
sophisticated off-chain offer protocol" — consistent with the contract-source
finding above, from a different angle. Third-party NFT indexers that do exist
for Blur (Bitquery, SimpleHash, Alchemy) appear to only re-index the same
on-chain events this subgraph already captures, not the live off-chain
orderbook. No concrete, documented endpoint for outstanding offers — official
or reverse-engineered — turned up anywhere. Not building against anything
undocumented and unverified; there's no stable foundation there to depend on.

### What's actually available, if partial visibility into offer *lifecycle* is useful

`OfferCancelled` and `NonceIncremented` could be indexed to show an audit
trail of *cancelled/invalidated* offers per lender — real data, but it answers
"what did this lender kill" not "what's currently live." Not implemented;
flagging as an option if that partial view turns out to be useful later.
