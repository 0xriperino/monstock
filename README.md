# StockBack

A memecoin launchpad on **Monad Testnet (10143)**. Every meme trades against
**MockSPYx**, a test-only ERC20 representation of a stock. It is not a real stock
or security. No real stock API, database, backend, or indexer is required.

## Features and architecture

- Fixed 1,000,000-token supply, one market and one StockVault per coin.
- Constant-product AMM; initial liquidity is permanently locked.
- 1% stock-side trading fee: 40% to holders, 10% to the associated Vault,
  50% to treasury. Integer rounding remainder goes to treasury.
- Permissionless **300-second settlement**. Someone must submit `settleEpoch()`;
  there is no automatic background process or keeper.
- Holder rewards use balances at settlement, exclude market inventory, and
  checkpoint transfers so past settled rewards remain with their owners.
- Claim MockSPYx to your wallet, then deposit it or other wallet MockSPYx into
  a Vault for 30/90/180 days with 1.00x/1.25x/1.60x reward weights.
- Next.js, TypeScript, Tailwind, wagmi injected wallets, viem contract calls,
  and TanStack Query. Financial data comes directly from contracts.
- The frontend preserves the `StockBackApp` data/actions interface and the
  StockBack purple design. No synthetic balances are used by the home page.

`contracts/src` contains the team's contracts; `contracts/test/Integration.t.sol`
exercises the real Factory, AMM, token and Vault together. `web/src/lib/stockback.ts`
implements reads, quotes, validations and confirmed transactions; `web/src/hooks`
handles caching, wallet/account changes and receipt-driven UI state.
`web/src/lib/abis.ts` is generated from **actual Foundry artifacts**.

All fourteen actions are connected: wallet connection, network switch, faucet,
coin creation (including initial approval), market selection, stock/meme approvals,
buy, sell, settlement, holder claim, Vault approval, deposit and withdrawal.
Amounts use bigint base units; quotes and UI values use exact decimal strings.
The UI becomes successful only after a successful receipt, then refreshes reads.

## Deployment status and network

| Item | Value |
| --- | --- |
| Target | Monad Testnet |
| Chain ID | 10143 |
| RPC | https://testnet-rpc.monad.xyz |
| Explorer | https://testnet.monadscan.com |
| Testnet contract addresses | **Not deployed** — see `shared/deployments.json` |
| Public frontend URL | Not hosted; hosting credentials are not configured |
| Local app | http://127.0.0.1:3100 when started with the command below |

The deployment wallet is `0x7640dfaE2C612aBa5567477aAa91B181F6de1A7C`
on Monad Testnet (see `shared/deployer.json`). Its signing credential exists only
in the ignored, access-restricted local `.env`; it is never part of this repository.
The testnet dry-run passed and estimated about 1.22 MON at the observed gas price;
3 test MON provides a deployment/demo budget. Deployment is awaiting funding,
and Vercel publication is awaiting the account connection. No testnet contract
addresses or transaction hashes are invented. Real, temporary
**local Anvil** addresses and receipt hashes are saved separately in ignored
`shared/deployments.local.json` by the local demo. They are not Monad addresses.

## Install

Requirements: Node.js 20.9+ (validated with 24.x), npm, Git and Foundry (`forge`,
`anvil`, `cast`). From the repository root:

```sh
git submodule update --init --recursive
forge build
node contracts/script/export-abis.mjs
cd web
npm ci
```

On Windows, if Foundry is not on PATH, add its installed directory in PowerShell:

```powershell
$env:PATH = "$env:USERPROFILE\.foundry\bin;$env:PATH"
```

## Local development and reproducible on-chain demo

Start a disposable, localhost-only Anvil node in one terminal. `--silent` suppresses
the development-key startup display; the test scripts use unlocked local accounts
and never load, save or print a private key.

```sh
anvil --silent --host 127.0.0.1 --port 8545 --chain-id 31337 --accounts 3 --block-time 1
```

In another terminal, from the root:

```sh
forge build
node contracts/script/export-abis.mjs
cd web
npm ci
npm run demo:local
npm run build
npm run start -- --port 3100
```

`demo:local` deploys and tests real contracts, then restores its test state/clock
and creates a fresh demo market. It writes public local addresses to ignored
`web/.env.local` and `shared/deployments.local.json`. Restart Next.js after changing
public environment variables because they are included at build time. To develop
with hot reload instead, use `npm run dev -- --port 3100`.

The local node mines a block each second so the UI can observe advancing chain
time while waiting for an epoch. This does not settle epochs automatically.

The app clearly labels **LOCAL ANVIL** in this mode. Use a browser wallet on
chain 31337. To fund your own wallet with local gas without exposing a key,
obtain a public unlocked address with `cast rpc eth_accounts --rpc-url
http://127.0.0.1:8545`, then use:

```sh
cast send <YOUR_WALLET> --value 1ether --from <ANVIL_ACCOUNT> --unlocked --rpc-url http://127.0.0.1:8545
```

Stopping/resetting Anvil removes its ephemeral deployments. Rerun the demo and
rebuild the frontend after a reset. Without configured deployments, the default
Monad page shows a clear deployment notice and unavailable values, not demo data.

## Tests

Validated on 24 October 2026: `forge build`, all **58 Foundry tests**,
strict TypeScript and the Next.js production build passed. The viem local demo
confirmed 17 recorded test transactions (plus the automatically orchestrated
initial approval), and the browser E2E passed all fourteen UI callbacks, rejected
approval/retry, actual receipt handling, and 12 responsive view checks. These are
**local Anvil** results; no Monad deployment or testnet transaction is claimed.

From the root:

```sh
forge build
forge test -vv
```

From `web`:

```sh
npm run typecheck
npm run build
npm run demo:local
```

The local demo checks real transaction receipts, faucet limits, automatic initial
approval, creation, buy/sell, missing allowance rejection, quote tamper/reuse
rejection, settlement timing, real Vault funding, claim/no double claim, both
deposit sources, two locked positions, early withdrawal rejection by client and
contract, and successful withdrawal after **local-only** time advancement.

For browser E2E, first run the local demo, build the app, and leave the local
server running on port 3100. Then in another `web` terminal:

```sh
npm run test:browser
```

The browser test uses installed Chrome on Windows. Elsewhere run
`npx playwright install chromium`, or supply `BROWSER_PATH`. `E2E_URL` may select
another localhost port. The test-only EIP-1193 fixture forwards actual transactions
to unlocked Anvil accounts; it is never shipped in the app. It checks all fourteen
callbacks through the UI, network switching, rejected approval/retry, confirmed
receipts, deposits/unlock, and responsive layouts. Its state and clock are restored
afterward. Do not interact with that disposable node during an E2E run.

## Monad Testnet deployment

Copy root `.env.example` to `.env` and configure `DEPLOYER_PRIVATE_KEY` and
`MONAD_RPC_URL`. Optionally set `TREASURY_ADDRESS`; otherwise it is the deployer.
Fund the deployer with testnet MON for gas. Never use a mainnet key or expose
signing credentials through `NEXT_PUBLIC_*` variables.

```sh
forge script contracts/script/Deploy.s.sol:Deploy --rpc-url monad_testnet --broadcast
node --env-file=.env contracts/script/export-deployment.mjs broadcast/Deploy.s.sol/10143/run-latest.json
```

The script deploys MockStock and Factory, claims test stock, and calls `createCoin`
to deploy the initial meme, market and Vault. The exporter accepts successful
testnet receipts, checks chain ID and deployed code, then records real addresses,
transaction hashes and explorer links in `shared/deployments.json`. Simulation
alone is not deployment. Never export dry-run data as a successful deployment.

For frontend configuration, copy `web/.env.example` to `web/.env.local`, keep
`NEXT_PUBLIC_USE_ANVIL=false`, and supply the actual stock/Factory addresses and
RPC. Alternatively the verified committed testnet deployment record provides
fallback addresses. Remove local Anvil overrides before building for testnet.

For Vercel, set project root to `web`, supply only public frontend variables,
set the production Git branch to `main`, and run the normal Next.js production
build. `web/vercel.json` declares the Next.js build settings. Keep
`NEXT_PUBLIC_USE_ANVIL=false`; never use localhost RPC or local contract addresses
in the public deployment. Never upload the root signing `.env`.
Hosting has not yet been performed; the Vercel connection is pending.

## Interactive demo steps

1. Connect your injected wallet; switch to the configured test network.
2. Get test MockSPYx (one faucet claim per wallet).
3. Launch a coin with initial liquidity; confirm the approval and creation.
4. Open its trading card, approve MockSPYx, refresh the quote, and buy.
5. Choose Sell, approve the meme amount, refresh the quote, and sell part.
6. After 300 seconds, refresh chain data and submit **Settle epoch**.
7. Claim the holder reward to your wallet.
8. Select that market in **Vault destination**; deposit the claimed amount.
9. Deposit additional wallet MockSPYx with another supported lock period.
10. Show the two positions and their real unlock timestamps. Positions aggregate
    across markets; IDs contain the owning Vault to avoid collisions.
11. Locked withdrawal buttons remain disabled; the local tests also demonstrate
    the contract rejecting a direct early withdrawal. Successful unlock demos
    advance time only on disposable local chains; no early-unlock function exists.

## Known limitations

- Public testnet deployment, real injected-wallet signing on Monad, public hosting,
  and a live testnet end-to-end demo remain unverified until credentials/funds are
  available. Local Anvil results are not presented as Monad transactions.
- Settlement uses balances at settlement time, allowing last-minute positioning.
  It is not time-weighted. Vault rewards are variable trading-fee income, not APY.
- Reads refresh every 15 seconds and after confirmed transactions. Manual refresh
  is available. Quotes expire after 45 seconds, are rechecked before signing, and
  enforce an on-chain minimum output; a price change can still revert a trade.
- With no eligible holders/stakers, that fee share goes to treasury. Rounding dust
  stays reserved and cannot be spent as AMM liquidity or Vault principal.
- The generic injected-wallet connector supports wallets exposing EIP-1193;
  no WalletConnect project, custom authentication, database or server is needed.
- Market discovery and position reads scale with market/position count. This is
  a small hackathon demo, not an indexed production trading terminal.
- The UI lists positions from all markets; the top selector controls the Vault
  used for new approvals/deposits. A browser wallet still must approve every real
  transaction. Local browser tests use a test fixture, not a real extension.
