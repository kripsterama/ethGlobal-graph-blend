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

### Derived client-side (not stored — computed at query/render time)

Confirmed against the actual Blend contract source (`Helpers.computeCurrentDebt`,
verified on Blockscout): interest is **continuously compounded**, not simple/linear.

```
debt(t) = loanAmount * e^(rate/10000 * years_elapsed)
```

- **APY %** — fixed for the life of the loan (it's a loan term the lender accepted
  when making the offer; it only changes if the loan is refinanced to a new rate).
  Derived once from `rate` (bips):

  ```
  APY% = (e^(rate / 10000) - 1) * 100
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
