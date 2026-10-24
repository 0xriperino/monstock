import { test } from "node:test";
import assert from "node:assert/strict";
import { parseEther, type Address, type PublicClient, type WalletClient } from "viem";
import { anvil } from "viem/chains";
import { StockBackClient, type QuoteAssetConfig } from "./stockback";

const address = (id: number) => `0x${id.toString(16).padStart(40, "0")}` as Address;
const assets: QuoteAssetConfig[] = [
  { id: address(1), factory: address(2), name: "S&P 500", symbol: "SPYX", decimals: 18 },
  { id: address(3), factory: address(4), name: "NVIDIA", symbol: "NVDAX", decimals: 18 },
];
const pools = assets.map((stockToken, index) => ({
  market: address(10 + index), meme: address(20 + index), vault: address(30 + index),
  stock: stockToken.id, stockToken, tradingFeeBps: 100,
}));

test("all pairs are discoverable while balances, allowances and reward totals retain their asset", async () => {
  const reads: { address: Address; functionName: string; args?: readonly unknown[] }[] = [];
  const rpc = {
    getBlock: async () => ({ timestamp: 100n }),
    readContract: async (request: typeof reads[number]) => {
      reads.push(request);
      switch (request.functionName) {
        case "balanceOf": return parseEther("10");
        case "hasClaimed": return true;
        case "name": return "Meme";
        case "symbol": return request.address === pools[0].meme ? "SPME" : "NVME";
        case "getReserves": return [parseEther("100"), parseEther("1000")];
        case "nextEpochAt": return 200n;
        case "pendingHolderRewards": return parseEther(request.address === pools[0].market ? "2" : "7");
        case "allowance": return parseEther(request.address === assets[0].id ? "3" : "9");
        case "getPositions": return [{ id: 1n, amount: parseEther("5"), startAt: 0n, unlockAt: 30n * 86400n, withdrawn: false }];
        case "pendingRewards": return parseEther("1");
        default: throw new Error(`Unexpected read: ${request.functionName}`);
      }
    },
  } as unknown as PublicClient;
  for (const [index, asset] of assets.entries()) {
    reads.length = 0;
    const client = new StockBackClient(rpc, anvil, asset.id, asset.factory, async () => ({} as WalletClient), undefined, assets);
    client.assertDeployment = async () => {};
    client.pools = async () => pools;
    const snapshot = await client.snapshot(address(99));
    assert.deepEqual(snapshot.markets.map(market => market.stockToken?.symbol), ["SPYX", "NVDAX"]);
    assert.equal(snapshot.selectedMarketId, pools[index].market);
    assert.equal(snapshot.stockToken.symbol, asset.symbol);
    assert.equal(snapshot.portfolio.claimableHolderRewards, index === 0 ? "2" : "7");
    assert.equal(snapshot.vault.totalLockedPrincipal, "5");
    assert.equal(snapshot.vault.positions.length, 1);
    assert.deepEqual(snapshot.markets.map(market => market.stockApproval.allowance), ["3", "9"]);
    assert.deepEqual(reads.filter(read => read.functionName === "getPositions").map(read => read.address), [pools[index].vault]);
    const selected = await client.snapshot(address(99), pools[index].market);
    assert.equal(selected.selectedMarketId, pools[index].market);
  }
});
