import { test } from "node:test";
import assert from "node:assert/strict";
import { parseEther, zeroAddress, type Address, type PublicClient } from "viem";
import { buildActivity, buildCandles, readMarketActivity, type MarketTrade, type TransferRecord, type SwapRecord } from "./market-activity";

const address = (n: number) => `0x${n.toString(16).padStart(40, "0")}` as Address;
const pool = address(1), token = address(2), alice = address(3), bob = address(4);
const transfer = (block: number, from: string, to: string, value: string): TransferRecord => ({ blockNumber: BigInt(block), logIndex: 0, from, to, value: parseEther(value) });
const swap = (block: number, isBuy: boolean, amountIn: string, amountOut: string, stockFee: string): SwapRecord => ({ blockNumber: BigInt(block), logIndex: 1, hash: `0x${block}`, trader: alice, isBuy, amountIn: parseEther(amountIn), amountOut: parseEther(amountOut), stockFee: parseEther(stockFee) });

test("holder ranking includes wallet transfers and burns, excludes pool, and uses actual supply", () => {
  const transfers = [transfer(5, zeroAddress, pool, "1000"), transfer(7, pool, alice, "100"), transfer(8, alice, bob, "40"), transfer(9, bob, zeroAddress, "5")];
  const activity = buildActivity(transfers, [], new Map([[5n, 300]]), pool, 20n, 1200);
  assert.equal(activity.totalSupply, "995");
  assert.equal(activity.holderCount, 2);
  assert.deepEqual(activity.holders.map(h => [h.address, h.amount]), [[alice, "60"], [bob, "35"]]);
  assert.equal(activity.holders[0].share, 6.0301);
  assert.throws(() => buildActivity(transfers.slice(1), [], new Map(), pool, 20n, 1200), /Incomplete/);
});

test("OHLC and quote volume use confirmed buy/sell executions and the selected timeframe", () => {
  const activity = buildActivity([transfer(1, zeroAddress, pool, "1000")], [swap(2, true, "10", "10", "1"), swap(3, false, "10", "12", "1"), swap(4, true, "20", "10", "1")], new Map([[1n, 0], [2n, 60], [3n, 90], [4n, 125]]), pool, 5n, 130);
  assert.equal(activity.volume24h, "43");
  assert.deepEqual(buildCandles(activity.trades, 60), [
    { time: 60, open: .9, high: 1.2, low: .9, close: 1.2, volume: 23 },
    { time: 120, open: 1.9, high: 1.9, low: 1.9, close: 1.9, volume: 20 },
  ]);
  assert.equal(buildCandles(activity.trades, 300).length, 1);
  assert.throws(() => buildActivity([transfer(1, zeroAddress, pool, "1000")], [swap(2, true, "1", "1", "0")], new Map(), pool, 5n, 130), /timestamp/);
});

test("history scan splits RPC log limits and replaces overlapping logs after a short reorg", async () => {
  let head = 22n;
  let recipient = alice;
  let calls = 0;
  const rpc = {
    getBlockNumber: async () => head,
    getCode: async ({ blockNumber }: { blockNumber: bigint }) => blockNumber >= 5n ? "0x6000" : undefined,
    getBlock: async ({ blockNumber }: { blockNumber: bigint }) => ({ timestamp: blockNumber * 60n }),
    getLogs: async ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) => {
      calls++;
      if (toBlock - fromBlock > 5n) throw new Error("block range limit exceeded");
      const records = [transfer(5, zeroAddress, pool, "1000"), transfer(18, pool, recipient, "100")];
      return records.filter(log => log.blockNumber >= fromBlock && log.blockNumber <= toBlock).map(({ blockNumber, logIndex, ...args }) => ({ eventName: "Transfer", address: token, blockNumber, logIndex, args }));
    },
  } as unknown as PublicClient;
  const first = await readMarketActivity(rpc, 999001, pool, token);
  assert.ok(calls > 2, "range rejection should have caused smaller log requests");
  assert.equal(first.holders[0].address, alice);
  head = 24n;
  recipient = bob;
  const next = await readMarketActivity(rpc, 999001, pool, token);
  assert.equal(next.holders.length, 1);
  assert.equal(next.holders[0].address, bob);
  assert.equal(next.holders[0].amount, "100");
});

test("recent trades preview appears before a concurrent full holder scan finishes", { timeout: 5000 }, async () => {
  let active = 0, peak = 0, finished = false;
  const mint = { eventName: "Transfer", address: token, blockNumber: 10n, logIndex: 0, args: { from: zeroAddress, to: pool, value: parseEther("1000") } };
  const buy = { eventName: "Swap", address: pool, blockNumber: 2100n, logIndex: 1, transactionHash: "0x123", args: { trader: alice, isBuy: true, amountIn: parseEther("10"), amountOut: parseEther("100"), stockFee: parseEther("0.1") } };
  const rpc = {
    getBlockNumber: async () => 2200n,
    getCode: async ({ blockNumber }: { blockNumber: bigint }) => blockNumber >= 10n ? "0x6000" : undefined,
    getBlock: async ({ blockNumber }: { blockNumber: bigint }) => ({ timestamp: blockNumber + 100000n }),
    getLogs: async ({ address, fromBlock, toBlock }: { address: string | string[]; fromBlock: bigint; toBlock: bigint }) => {
      if (Array.isArray(address)) {
        peak = Math.max(peak, ++active);
        await new Promise(resolve => setTimeout(resolve, 30));
        active--;
      }
      return [mint, buy].filter(log => log.blockNumber >= fromBlock && log.blockNumber <= toBlock && (Array.isArray(address) || log.address === address));
    },
  } as unknown as PublicClient;
  let showPreview!: (trades: MarketTrade[]) => void;
  const preview = new Promise<MarketTrade[]>(resolve => { showPreview = resolve; });
  const pending = readMarketActivity(rpc, 999002, pool, token, 0n, { onPreview: showPreview }).then(activity => { finished = true; return activity; });
  const trades = await preview;
  assert.equal(finished, false, "the chart should render while verified holders are still loading");
  assert.equal(trades.length, 1);
  assert.equal(trades[0].price, .099);
  const activity = await pending;
  assert.ok(peak > 1, "independent log ranges should be fetched concurrently");
  assert.equal(activity.trades.length, 1);
  assert.equal(activity.totalSupply, "1000");
});
