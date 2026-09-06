---
name: blend-active-loans
description: >-
  Query the Blend subgraph for currently active (open) loans and enrich them
  with computed APY, ETH amounts, accrued gains, and NFT collection names.
  Use when the user asks about active/open Blend loans, e.g. "show me open
  loans", "what loans are currently active", "list active Blend positions".
---

# Blend Active Loans

Fetches every `ACTIVE`-status `Lien` from the Blend subgraph and enriches the
raw on-chain fields with values the subgraph deliberately does not store
(collection name, human units, and time-dependent interest math). See
`blend/USE_CASES.md` (UC1) for the full derivation and reasoning behind these
formulas — this skill just executes that use case end to end.

## Configuration

- **Endpoint (test, ~3-day window, currently live):**
  `https://api.studio.thegraph.com/query/1758724/blend/v0.0.2`
- **Endpoint (production, full history):** not yet deployed — `subgraph.yaml`
  currently has a temporary test `startBlock` (see the comment above it).
  Once the full-history version is deployed, update this file with its
  version URL (`.../blend/v0.0.X`) and prefer it over the test endpoint.
- **RPC for collection name lookups:** any public Ethereum mainnet JSON-RPC
  endpoint works (e.g. `https://ethereum.publicnode.com`). No API key needed
  — this skill reads collection names directly from each NFT contract's
  on-chain `name()` function rather than depending on a rate-limited/keyed
  NFT metadata API.

## Steps

1. **Query active loans.** POST this to the endpoint above:

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
