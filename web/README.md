# StockBack web

```sh
cd web
npm ci
npm run dev
```

Open http://127.0.0.1:3000. `npm run build` creates the production build;
`npm run typecheck` checks all components.

The current home page is an explicitly labeled synthetic preview. Wallet and
transaction callbacks reject requests rather than invent successful trades.
Developer 4 can replace the preview entry with `StockBackApp` and supply real
`data` and `actions`; its public props contract is unchanged. See
`src/components/INTEGRATION.md` for the interface.

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

All 55 Foundry tests also passed. The preview does not validate end-to-end wallet
transactions; real deployment addresses and the wallet integration are still needed.
