import { test } from "node:test";
import assert from "node:assert/strict";
import { defineChain, type PublicClient } from "viem";
import { StockBackClient } from "./stockback";

const stock = "0x0000000000000000000000000000000000000001";
const factory = "0x0000000000000000000000000000000000000002";
const market = "0x0000000000000000000000000000000000000003";
const unrelated = "0x0000000000000000000000000000000000000004";
const meme = "0x0000000000000000000000000000000000000005";
const vault = "0x0000000000000000000000000000000000000006";
const chain = defineChain({ id: 10143, name: "Monad Testnet", nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 }, rpcUrls: { default: { http: ["http://127.0.0.1"] } } });

test("a quote reads only the selected registered market, even if another market is unavailable", async () => {
  const calls: string[] = [];
  const rpc = {
    getBlockNumber: async () => 1n,
    readContract: async ({ address, functionName }: { address: string; functionName: string }) => {
      calls.push(`${address}:${functionName}`);
      if (address === unrelated) throw new Error("Unrelated market RPC failed");
      switch (functionName) {
        case "getMarkets": return [market, unrelated];
        case "memeToken": return meme;
        case "vault": return vault;
        case "stockToken": return stock;
        case "quoteBuy": return 10n ** 18n;
        case "getReserves": return [100n * 10n ** 18n, 1000n * 10n ** 18n];
        default: throw new Error(`Unexpected read ${functionName}`);
      }
    },
  } as unknown as PublicClient;
  const client = new StockBackClient(rpc, chain, stock, factory, async () => { throw new Error("No signing in quote tests"); });
  const quote = await client.quote({ marketId: market, side: "buy", amount: "1", slippageBps: 50 });
  assert.equal(quote.outputAmount, "1");
  assert.equal(quote.minimumOutput, "0.995");
  assert.equal(calls.some(call => call.startsWith(unrelated)), false);
  await assert.rejects(client.pool("0x0000000000000000000000000000000000000099"), /not registered/);
});

test("selected-asset legacy and launcher quotes preserve their 1% and 3% fees", async () => {
  const launcher = "0x0000000000000000000000000000000000000007";
  const otherFactory = "0x0000000000000000000000000000000000000008";
  const otherStock = "0x0000000000000000000000000000000000000009";
  let launched = false;
  const rpc = {
    getBlockNumber: async () => 1n,
    readContract: async ({ address, functionName }: { address: string; functionName: string }) => {
      assert.notEqual(address, otherFactory, "Other assets must not hold up the selected pair");
      switch (functionName) {
        case "getMarkets": return address === launcher ? (launched ? [market] : []) : (launched ? [] : [market]);
        case "memeToken": return meme;
        case "vault": return vault;
        case "stockToken": return stock;
        case "tradingFeeBps": return 300n;
        case "quoteBuy": return 10n ** 18n;
        case "getReserves": return [100n * 10n ** 18n, 1000n * 10n ** 18n];
        default: throw new Error(`Unexpected read ${functionName}`);
      }
    },
  } as unknown as PublicClient;
  const client = new StockBackClient(rpc, chain, stock, factory, async () => { throw new Error("No signing"); }, undefined,
    [{ id: otherStock, factory: otherFactory, name: "Other", symbol: "OTHER", decimals: 18 },
      { id: stock, factory, name: "Stock", symbol: "STOCK", decimals: 18 }], launcher);
  const request = { marketId: market, side: "buy" as const, amount: "10", slippageBps: 50 };
  assert.equal((await client.quote(request)).feeAmount, "0.1");
  launched = true;
  assert.equal((await client.quote(request)).feeAmount, "0.3");
  const pool = await client.pool(market);
  assert.equal(pool.stock, stock);
  assert.equal(pool.stockToken.symbol, "STOCK");
  assert.equal(pool.tradingFeeBps, 300);
});
