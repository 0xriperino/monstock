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
Public Monad deployment is blocked by missing signing credentials/testnet gas.
