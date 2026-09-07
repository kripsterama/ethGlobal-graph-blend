---
name: blend-active-loans
description: >-
  Query the Blend subgraph for currently active (open) loans and enrich them
  with computed APY, ETH amounts, accrued gains, and NFT collection names.
  Optionally filter to a single lender wallet address and/or a single NFT
  collection. Use when the user asks about active/open Blend loans, e.g.
  "show me open loans", "what loans are currently active", "list active
  Blend positions", "show active loans for lender 0x...", "active loans
  against BAYC".
---

# Blend Active Loans

Fetches `ACTIVE`-status `Lien`s from the Blend subgraph and enriches the raw
on-chain fields with values the subgraph deliberately does not store
(collection name, human units, and time-dependent interest math). See
`blend/USE_CASES.md` (UC1: all active loans; UC2: active loans for one
lender) for the full derivation and reasoning behind these formulas — this
skill just executes those use cases end to end.

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
  keys to the same `where` object alongside `status: ACTIVE`.
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
- **RPC for collection name lookups:** any public Ethereum mainnet JSON-RPC
  endpoint works (e.g. `https://ethereum.publicnode.com`). No API key needed
  — this skill reads collection names directly from each NFT contract's
  on-chain `name()` function rather than depending on a rate-limited/keyed
  NFT metadata API.

## Steps

1. **Query active loans.** POST this to the endpoint above. `where` starts
   with just `status: ACTIVE`; add `lender`/`collection` keys per the
   Filtering section above if the invocation asked for them:

   ```graphql
   query ActiveLoans {
     liens(
       first: 100
       where: { status: ACTIVE }
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

2. **Resolve collection names on-chain.** Collect the distinct `collection`
   addresses from the results (dedupe — don't look up the same collection
   twice). For each one, call its ERC-721 `name()` function via `eth_call`
   (function selector `0x06fdde03`, no arguments) against the RPC endpoint,
   and ABI-decode the returned string:

   ```bash
   curl -s -X POST https://ethereum.publicnode.com \
     -H "Content-Type: application/json" \
     --data '{"jsonrpc":"2.0","method":"eth_call","params":[{"to":"<collection_address>","data":"0x06fdde03"},"latest"],"id":1}'
   ```

   The result is ABI-encoded (offset + length + UTF-8 bytes, padded to 32
   bytes) — decode it (e.g. with a short Python snippet) rather than
   eyeballing the hex.

3. **Get the current time** for the gains calculation: `date +%s`.

4. **Compute the derived fields per loan**, using `interestStartTimestamp`
   (not `createdAtTimestamp` — they diverge after a refinance) as the accrual
   basis. `rate` (bips) is itself the quoted annual rate — convert directly
   to a percent, don't run it through an exponential transform. Debt/gains
   growth over time, however, *is* continuously compounded (confirmed
   against the actual Blend contract source, `Helpers.computeCurrentDebt`):

   ```
   loan_eth      = loanAmount / 1e18
   apy_pct       = rate / 100                          # e.g. 1300 bips -> 13.00%
   years_elapsed = (now_unix - interestStartTimestamp) / (365 * 86400)
   gains_eth     = loan_eth * (e^(rate/10000 * years_elapsed) - 1)
   issued_at     = createdAtTimestamp converted to the user's local timezone
                   (detect it from the local machine, e.g. `date +%Z` or
                   Python's `datetime.now().astimezone().tzinfo` — don't
                   assume UTC or hardcode a specific zone)
   ```

   Do this arithmetic with a real calculator (e.g. `python3 -c "import math; ..."`)
   rather than approximating by hand — the exponential is easy to get
   meaningfully wrong via mental math, especially at higher rates.

5. **Present as a table**, one row per loan: Lien ID, Collection (name +
   tokenId), Loan Amount (ETH), APY %, Gains to Date (ETH), Lender address,
   Issued (date/time).

## Notes

- `rate` is in basis points; `loanAmount` is in wei. Never display either
  raw without converting.
- APY is fixed for the life of the current loan terms (it only changes on a
  `Refinance`) — don't imply it fluctuates.
- Gains-to-date is inherently a live, recompute-every-time number — don't
  cache or reuse a previously computed value across invocations.
- If a collection's `name()` call reverts or returns empty (some contracts
  don't implement it, or use `bytes32` instead of `string`), fall back to
  showing the raw collection address instead of failing the whole query.
