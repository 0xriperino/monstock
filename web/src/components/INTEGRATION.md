# StockBack component handoff

Import the named `StockBackApp` export from `src/components/StockBackApp` in an App Router client boundary and supply `data` and `actions`. The component imports its scoped stylesheet. Keep the host app’s existing Tailwind setup; the stylesheet does not reset elements outside `.sb-app`. React, Lucide React, and the host Next.js build are the only runtime dependencies.

```tsx
<StockBackApp data={uiData} actions={uiActions} />
```

The exact TypeScript contract is in [`../types/ui.ts`](../types/ui.ts). The app renders entirely from props; it does not import the synthetic fixtures. `preview/StockBackPreview.tsx` is an optional development entry with clearly labeled synthetic data and rejecting transaction callbacks. It never simulates a successful transaction.

## Data conventions

- All token amounts, balances, allowances, reserves, quotes, and rewards are non-negative human-readable decimal strings, not base-unit integers. Supply the appropriate token decimals. `null` means unavailable; it is displayed as a dash, never zero.
- `estimatedPrice` is MockSPYx per meme token. Supply it from the integration; the UI does not price pools or estimate execution.
- `wallet.address` is display data; token and market `id` fields are opaque identifiers. No chain addresses are embedded in components.
- All timestamps are Unix milliseconds. Displayed dates use UTC. The vault form’s estimated date is based on the client clock; actual unlock eligibility requires both elapsed time and integration-provided `canWithdraw`.
- `initialView` sets only the initial local view. `selectedMarketId` is controlled: `selectMarket(id)` must publish the selected ID back through data. Navigation itself is local.
- Publish explicit loading/error/ready states for markets, balances, and positions. Keep wallet-specific values current when accounts or networks change. Successful transaction text appears only for `transaction.status: "success"`, which the integration should set after receipt confirmation.
- Holder rewards are market-specific. Portfolio totals and vault totals come directly from the integration. No profit/loss calculations or APY are invented.

## Actions

Every required action returns `void | Promise<void>`:

```ts
connectWallet()
switchNetwork()
requestFaucet()
createCoin({ name, symbol, initialStockLiquidity })
selectMarket(marketId)
approveStock({ marketId, amount })
approveMeme({ marketId, amount })
buy({ marketId, side, amount, slippageBps, quoteId, minimumOutput })
sell({ marketId, side, amount, slippageBps, quoteId, minimumOutput })
settleEpoch(marketId)
claimHolderRewards(marketId)
approveVault(amount)
depositToVault({ amount, lockDays })
withdrawFromVault(positionId)
```

The optional `requestTradeQuote({ marketId, side, amount, slippageBps })` callback is required to enable executable trades. Publish its result through `data.tradeQuote`, including a unique quote ID, matching request values, the output, minimum output, 1% fee in the input asset, status, and expiry. Input means MockSPYx on buy and meme tokens on sell. Quote requests fire on input edits and explicit refresh. Debounce and discard obsolete requests in the integration if needed; the UI displays only a matching, unexpired quote.

Clear stale transaction state when beginning a new action. Publish pending, success, and error states from the actual wallet/receipt lifecycle. A resolved callback never generates a success message. Rejected callbacks display an error and allow retry. Approval buttons respect amount-specific allowances; the deposit form also requires acknowledgment of the full lock term. `createCoin` must orchestrate any initial-liquidity approval needed before token creation because no pre-market ID exists yet.

Revalidate all balances, allowances, limits, quote amounts, slippage, expiry, network, and eligibility immediately before signing. UI guards are presentation safeguards. The contract and integration remain authoritative.

## Component boundaries

- `StockBackApp.tsx`: shell, four-view navigation, wallet/network notices, transaction feedback, shared action serialization.
- `overview-views.tsx`: `LaunchpadView`, `PortfolioView`.
- `TradingView.tsx`: pool data, amount-specific approvals, quote protection, trades, holder rewards and epoch settlement.
- `AutoVaultView.tsx`: deposit/lock acknowledgment, 30/90/180-day weights, locked/unlocked positions.
- `ui.tsx`: buttons, panels, stat/description rows, loading/empty states, token marks, exact decimal validation and formatting.

The component package intentionally does not include app routes, providers, hooks, ABIs, wallet clients, package configuration, or a backend.

## Validation — 24 October 2026

The checkout had no package manifest, app routes, or existing lint/build commands. Validation ran against copies of the owned sources in an isolated temporary Next.js harness; no Developer 4 files were created or changed.

- Strict TypeScript: `tsc --noEmit` passed.
- ESLint with TypeScript, React Hooks, and JSX accessibility rules: `eslint src --max-warnings=0` passed.
- Next.js 16.4.3 production build with React 19: `next build` passed.
- Chromium browser checks: all four views at 1440, 820, 390, and 320px; no page overflow or runtime/hydration errors. Automated axe WCAG 2 A/AA and 2.1 AA scans reported no violations in these 16 view/viewport combinations. This is an automated check, not an accessibility certification.
- Behavioral checks covered all 14 required callbacks plus the optional quote bridge, exact creation payloads, wrong-network/disconnected states, insufficient balances and allowances, approvals in progress, expired/mismatched quotes, reward claims and epoch eligibility, vault acknowledgment, changed lock periods, locked and contract-ineligible withdrawals, loading/empty states, pending transactions, and explicit success/failure props. Resolving a callback did not produce a success state.
- Amount utility checks covered precision beyond `Number.MAX_SAFE_INTEGER`, 18-decimal token precision, invalid/negative/exponential input, tiny nonzero displays, unavailable balances, and amount-specific allowances.
- Visual review covered the four viewport sizes. A reserve wrapping at 320px was corrected with stacked financial stats; the review scored the fix resolved.

Integration still requires Developer 4’s routes/providers, installed host dependencies, wallet/network/faucet callbacks, chain data, amount-specific allowances, quote service, and receipt-driven transaction state. No end-to-end on-chain transaction was performed.
