import { test } from "node:test";
import assert from "node:assert/strict";
import { parseEther, type Address, type PublicClient } from "viem";
import { anvil } from "viem/chains";
import { StockBackClient, emptyData } from "./stockback";
import { marketPlaceholder } from "./market-placeholder";

const address = (id: number) => `0x${id.toString(16).padStart(40, "0")}` as Address;
const stock = address(1), factory = address(2), market = address(3), meme = address(4), vault = address(5);

test("warm snapshots reuse identity and registration but refresh wallet-specific financial state", async () => {
  const calls: { functionName: string; args?: readonly unknown[] }[] = [];
  const rpc = {
    getChainId: async () => 31337,
    getCode: async () => "0x6000",
    getBlock: async () => ({ timestamp: 100n }),
    readContract: async (request: typeof calls[number]) => {
      calls.push(request);
      switch (request.functionName) {
        case "stockToken": return stock;
        case "getMarkets": return [market];
        case "memeToken": return meme;
        case "vault": return vault;
        case "name": return "Test";
        case "symbol": return "TEST";
        case "getReserves": return [parseEther("100"), parseEther("1000")];
        case "nextEpochAt": return 200n;
        case "balanceOf": return parseEther(request.args?.[0] === address(99) ? "10" : "20");
        case "allowance": return parseEther("1");
        case "hasClaimed": return false;
        case "pendingHolderRewards": return 0n;
        case "getPositions": return [];
        default: throw new Error(`Unexpected ${request.functionName}`);
      }
    },
  } as unknown as PublicClient;
  const makeClient = () => new StockBackClient(rpc, anvil, stock, factory, async () => { throw new Error("Read-only tests"); });
  const first = await makeClient().snapshot(address(99));
  const coldReads = calls.length;
  calls.length = 0;
  const nextClient = makeClient();
  const next = await nextClient.snapshot(address(100));
  assert.equal(first.wallet.stockBalance, "10");
  assert.equal(next.wallet.stockBalance, "20");
  assert.ok(calls.length < coldReads);
  for (const name of ["getMarkets", "name", "symbol", "memeToken", "vault", "stockToken"]) assert.equal(calls.some(call => call.functionName === name), false, `${name} must be cached`);
  for (const name of ["getReserves", "balanceOf", "allowance", "getPositions"]) assert.ok(calls.some(call => call.functionName === name), `${name} must refresh`);
  calls.length = 0;
  await nextClient.pool(market);
  assert.equal(calls.length, 0, "known selected pools must not re-scan every factory for a quote");
  nextClient.invalidateCatalog();
  await nextClient.snapshot(address(100));
  assert.ok(calls.some(call => call.functionName === "getMarkets"), "confirmed launches must refresh registration immediately");
});

test("instant market placeholders retain public cards without reusing balances or allowances", () => {
  const data = emptyData("Monad Testnet");
  const quote = { id: stock, name: "Stock", symbol: "STOCK", decimals: 18 };
  data.stockToken = quote;
  data.wallet.stockBalance = "999";
  data.wallet.balancesStatus = "ready";
  data.marketsStatus = "ready";
  data.markets = [{ id: market, stockToken: quote, token: { id: meme, name: "Test", symbol: "TEST", decimals: 18 }, stockReserve: "100", memeReserve: "1000", estimatedPrice: "0.1", walletBalance: "200", claimableRewards: "3", stockApproval: { status: "approved", allowance: "999" }, memeApproval: { status: "approved", allowance: "999" }, nativeMemeApproval: { status: "approved", allowance: "999" }, epoch: { endsAt: 0, canSettle: true, isSettling: false } }];
  const next = marketPlaceholder(data, quote, market)!;
  assert.equal(next.marketsStatus, "ready");
  assert.equal(next.selectedMarketId, market);
  assert.equal(next.markets[0].token.name, "Test");
  assert.equal(next.wallet.stockBalance, null);
  assert.equal(next.wallet.balancesStatus, "loading");
  assert.equal(next.markets[0].walletBalance, null);
  assert.equal(next.markets[0].stockApproval.status, "unknown");
  assert.equal(next.markets[0].nativeMemeApproval?.status, "unknown");
  assert.equal(next.vault.approval.status, "unknown");
  assert.equal(data.wallet.stockBalance, "999", "the original account cache must remain unchanged");
});
