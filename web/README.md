# StockBack web

```sh
cd web
npm ci
npm run dev
```

Open http://127.0.0.1:3000. `npm run build` creates the production build;
`npm run typecheck` checks all components.

The home page now renders `StockBackConnected`, which provides real contract
data and transactions to `StockBackApp`. Its public props contract is unchanged.
See the root README for Anvil/testnet setup and `src/components/INTEGRATION.md`
for the component interface. Without deployed contract addresses, the app shows
an explicit deployment notice and does not load synthetic balances.

Discovery search, liquidity/name sorting, holdings/reward filters, navigation,
and the launch dialog work locally. Every displayed pool value comes from props.
The hero's line illustration is decorative and does not represent trading history.

Design research used REA 6.7.0 from https://github.com/morluto/rea to capture the
public StonkFun discovery and launch pages on 24 October 2026. The implementation
adapts the compact header, wide hero, search/filter bar and card grid to StockBack's
purple palette, fixed MockSPYx pair and fee-sharing model. Branding, text and SVG
artwork are original; no reference-site code, logos, token art or remote assets
are shipped.

REA evidence IDs:
- Discovery: `ev_b14619d5a818237b9b0c91a6555fd21ecc2f1880006ed507e6b498541d930c69`
- Launch: `ev_4e29fb8a8b286275934804b77b7c6316a0cc9866efa5e7a6f064c2781e6e9b97`

Evidence and screenshots are retained locally in the temporary
`monstock-design-tools` directory. REA used provider-owned Chrome sessions,
which were terminated after capture. No wallet was connected to the reference.

## Validation

The redesigned source passed the production Next.js build and strict TypeScript
check. Browser checks covered search, exact numeric sorting, holdings/rewards
filters, the Ctrl+K shortcut, launch amount validation, visible callback rejection,
and Escape dismissal. All four views were checked at 1440, 820, 390 and 320 pixels
with no horizontal overflow or page errors. Ten axe WCAG A/AA scans covered the
four views and launch dialog at desktop and mobile widths; no violations were
reported. These automated scans are not an accessibility certification.

The integration adds real-chain Anvil and browser E2E scripts; run
`npm run demo:local` and `npm run test:browser` as described in the root README.
The Monad Testnet contracts are deployed and source-verified. The real testnet
demo passed nine signed transactions; see `shared/testnet-e2e.json` at the repo
root. Vercel uses the public deployed addresses and never receives the signing key.

### Launch dialog regression checks

Start `npm run dev -- --port 3101`, then run `npm run test:launch` in another
terminal. Install Playwright Chromium with `npx playwright install chromium`,
or set `BROWSER_PATH` to an installed Chromium browser executable.
These tests use isolated wallet/RPC fixtures against the local app, with no
real transactions. They check connecting and switching networks inside the
modal, preserved inputs, missing/rejected wallets, faucet access, unavailable
balances, and disabled creation when input or funds are insufficient.

### Swap regression checks

With the same local app running on port 3101, run `npm run test:trading`.
It checks debounced estimates, approval followed by buy/sell without a manual
quote refresh, and estimate timeout/retry with late-response protection.
The wallet, RPC, and receipts are isolated fixtures; no real transactions are
submitted. `npm run test:client` checks that quoting a registered market does
not depend on the health of other markets. Spending approval and a fresh quote
are still required before a trade can be submitted.
