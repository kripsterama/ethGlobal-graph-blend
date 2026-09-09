---
name: blur-pool-balance
description: >-
  Check a wallet's ETH balance held in Blur Pool, the wrapped-ETH contract
  Blur/Blend use internally for payments (lenders typically keep working
  capital there rather than in a raw EOA balance). A single direct on-chain
  read, no subgraph involved. Use when the user asks "what's my Blur pool
  balance", "how much ETH do I have in Blur", "check my blur balance",
  "what's in my Blur wallet".
---

# Blur Pool Balance

A single `eth_call` — no subgraph, no GraphQL, no CoinGecko. This is
deliberately a separate, minimal skill from `blend-active-loans` rather than
a feature bolted onto it: different data source (direct RPC read vs. an
indexed subgraph), different trigger phrases, and no shared logic — bundling
it in would only make that skill's description less precise and its
instructions longer for no benefit.

## What Blur Pool is

Confirmed by reading Blend's actual contract source and cross-checking
on-chain, not assumed: Blend's `_POOL` (the contract every loan payment
routes through — `_POOL.transferFrom(...)`) is an immutable constructor
argument. Extracted the real deployed address from Blend's own verified
constructor arguments, then verified it independently three ways before
trusting it:

- Blockscout labels its implementation `BlurPool`.
- Calling `name()` on it directly returns `"Blur Pool"`.
- Its interface (`IBlurPool.sol`, in the same verified source bundle as
  Blend) is a standard wrapped-ETH pattern — `deposit()`/`withdraw()` at 1:1,
  `balanceOf(address)`, `decimals() == 18` (confirmed via `eth_call`) — i.e.
  functionally a Blur-specific WETH lenders hold working capital in rather
  than a raw wallet balance.

**Contract address:** `0x0000000000A39bb272e79075ade125fd351887Ac`

## Steps

1. **Get the wallet address** — from the invocation's args, prior
   conversation context, or ask if neither is available. Don't guess.

2. **Call `balanceOf(address)`** via `eth_call` against any public Ethereum
   mainnet RPC (e.g. `https://ethereum.publicnode.com`, keyless, same
   endpoint pattern as `blend-active-loans`). Function selector `0x70a08231`
   + the address left-padded to 32 bytes:

   ```bash
   curl -s -X POST https://ethereum.publicnode.com -H "Content-Type: application/json" \
     --data '{"jsonrpc":"2.0","method":"eth_call","params":[{"to":"0x0000000000A39bb272e79075ade125fd351887Ac","data":"0x70a08231000000000000000000000000<address_no_0x_prefix>"},"latest"],"id":1}'
   ```

3. **Convert the result**: it's a `uint256` in wei, 18 decimals (confirmed
   above) — divide by `1e18` for ETH. This is one number, not a table; no
   need for the multi-step script-and-format pattern `blend-active-loans`
   uses for a whole portfolio.

## Notes

- Balance is a live number — don't cache or reuse a value from an earlier
  invocation.
- If the address isn't a valid 40-hex-char address, the RPC call will
  either error or (worse) silently return `0` for an address that never
  interacted with the pool — confirm the address looks right before
  reporting a `0` balance as meaningful.
