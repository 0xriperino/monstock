import { formatUnits, parseAbiItem, parseUnits, zeroAddress, type Address, type PublicClient } from "viem";

const transferEvent = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
const swapEvent = parseAbiItem("event Swap(address indexed trader, bool isBuy, uint256 amountIn, uint256 amountOut, uint256 stockFee)");
export type TransferRecord = { blockNumber: bigint; logIndex: number; from: string; to: string; value: bigint };
export type SwapRecord = { blockNumber: bigint; logIndex: number; hash: string; trader: string; isBuy: boolean; amountIn: bigint; amountOut: bigint; stockFee: bigint };
export type MarketTrade = { id: string; hash: string; trader: string; isBuy: boolean; time: number; price: number; quoteAmount: string; tokenAmount: string };
export type MarketHolder = { address: string; amount: string; share: number };
export type MarketActivity = { trades: MarketTrade[]; holders: MarketHolder[]; holderCount: number; totalSupply: string; volume24h: string; blockNumber: string; updatedAt: number; launchedAt: number };
export type Candle = { time: number; open: number; high: number; low: number; close: number; volume: number };
const scanConcurrency = 6;
const scanWindow = 100n;

// Rebuild ownership from the complete ERC20 transfer history, including mints,
// burns and wallet-to-wallet transfers. Pool inventory is not a wallet holder.
export function buildActivity(transfers: TransferRecord[], swaps: SwapRecord[], timestamps: Map<bigint, number>, pool: string, blockNumber: bigint, now: number): MarketActivity {
  const balances = new Map<string, bigint>();
  let supply = 0n;
  for (const transfer of [...transfers].sort(orderLogs)) {
    const from = transfer.from.toLowerCase(), to = transfer.to.toLowerCase();
    if (from === zeroAddress) supply += transfer.value;
    else balances.set(from, (balances.get(from) ?? 0n) - transfer.value);
    if (to === zeroAddress) supply -= transfer.value;
    else balances.set(to, (balances.get(to) ?? 0n) + transfer.value);
  }
  if ([...balances.values()].some(balance => balance < 0n)) throw new Error("Incomplete token transfer history. Holder rankings are unavailable.");
  const holders = [...balances].filter(([address, balance]) => address !== pool.toLowerCase() && balance > 0n)
    .sort((a, b) => a[1] === b[1] ? a[0].localeCompare(b[0]) : a[1] > b[1] ? -1 : 1);
  let volume24h = 0n;
  const trades = buildTrades(swaps, timestamps);
  for (const trade of trades) if (trade.time >= now - 86400) volume24h += parseUnits(trade.quoteAmount, 18);
  const creation = transfers.find(transfer => transfer.from.toLowerCase() === zeroAddress);
  // A missing mint means the provider did not return the complete history.
  if (!creation || supply <= 0n) throw new Error("Token creation history is unavailable from this RPC.");
  return { trades, holders: holders.slice(0, 100).map(([address, balance]) => ({ address, amount: formatUnits(balance, 18), share: Number(balance * 1_000_000n / supply) / 10_000 })),
    holderCount: holders.length, totalSupply: formatUnits(supply, 18), volume24h: formatUnits(volume24h, 18), blockNumber: blockNumber.toString(), updatedAt: now, launchedAt: timestamps.get(creation.blockNumber) ?? now };
}

function buildTrades(swaps: SwapRecord[], timestamps: Map<bigint, number>): MarketTrade[] {
  return [...swaps].sort(orderLogs).map(swap => {
    const time = timestamps.get(swap.blockNumber);
    if (time === undefined) throw new Error("A trade timestamp could not be verified.");
    const quoteAmount = swap.isBuy ? swap.amountIn : swap.amountOut + swap.stockFee;
    const tokens = swap.isBuy ? swap.amountOut : swap.amountIn;
    const netQuote = swap.isBuy ? swap.amountIn - swap.stockFee : swap.amountOut;
    return { id: `${swap.hash}:${swap.logIndex}`, hash: swap.hash, trader: swap.trader, isBuy: swap.isBuy, time,
      price: tokens > 0n ? Number(formatUnits(netQuote * 10n ** 18n / tokens, 18)) : 0,
      quoteAmount: formatUnits(quoteAmount, 18), tokenAmount: formatUnits(tokens, 18) };
  });
}

function orderLogs(a: { blockNumber: bigint; logIndex: number }, b: { blockNumber: bigint; logIndex: number }) {
  return a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : a.blockNumber < b.blockNumber ? -1 : 1;
}

export function buildCandles(trades: MarketTrade[], interval: number): Candle[] {
  const result: Candle[] = [];
  for (const trade of trades) {
    if (!Number.isFinite(trade.price) || trade.price <= 0) continue;
    const time = Math.floor(trade.time / interval) * interval;
    let candle = result.at(-1);
    if (!candle || candle.time !== time) {
      candle = { time, open: trade.price, high: trade.price, low: trade.price, close: trade.price, volume: 0 };
      result.push(candle);
    }
    candle.high = Math.max(candle.high, trade.price);
    candle.low = Math.min(candle.low, trade.price);
    candle.close = trade.price;
    candle.volume += Number(trade.quoteAmount);
  }
  return result;
}

type ScanCache = { start: bigint; through: bigint; transfers: TransferRecord[]; swaps: SwapRecord[]; timestamps: Map<bigint, number> };
const scans = new Map<string, ScanCache>();

// Binary search avoids scanning years of unrelated blocks. Historical getCode
// failures remain explicit; partial history must never become a holder ranking.
async function deploymentBlock(client: PublicClient, token: Address, tip: bigint, earliest: bigint): Promise<bigint> {
  let low = earliest, high = tip;
  const code = await client.getCode({ address: token, blockNumber: tip });
  if (!code || code === "0x") throw new Error("Token contract is not available at the confirmed block yet.");
  while (low < high) {
    const middle = (low + high) / 2n;
    const previous = await client.getCode({ address: token, blockNumber: middle });
    if (previous && previous !== "0x") high = middle;
    else low = middle + 1n;
  }
  return low;
}

// Providers impose different log-range limits. Split rejected ranges, but never
// skip a range or publish an incomplete scan. Network/auth errors propagate.
async function readRange<T>(from: bigint, to: bigint, read: (from: bigint, to: bigint) => Promise<T[]>): Promise<T[]> {
  try { return await read(from, to); }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (from >= to || !/block range|ranges? over|too (?:many|large)|limit.*(?:block|result|range)|(?:block|result|range).*limit|response size|query returned/i.test(message)) throw error;
    const middle = (from + to) / 2n;
    return [...await readRange(from, middle, read), ...await readRange(middle + 1n, to, read)];
  }
}

type ReadOptions = { signal?: AbortSignal; onProgress?: (percent: number) => void; onPreview?: (trades: MarketTrade[]) => void };

// A small, recent chart can render while the complete transfer scan verifies
// holder balances. This preview never publishes holder counts or 24h volume.
async function recentTrades(client: PublicClient, market: Address, tip: bigint, signal?: AbortSignal): Promise<MarketTrade[]> {
  const start = tip > 2000n ? tip - 1999n : 0n;
  const ranges: { from: bigint; to: bigint }[] = [];
  for (let from = start; from <= tip; from += scanWindow) ranges.push({ from, to: from + scanWindow - 1n < tip ? from + scanWindow - 1n : tip });
  let next = 0;
  const swaps: SwapRecord[] = [];
  await Promise.all(Array.from({ length: Math.min(scanConcurrency, ranges.length) }, async () => {
    while (next < ranges.length) {
      signal?.throwIfAborted();
      const range = ranges[next++];
      const logs = await readRange(range.from, range.to, (fromBlock, toBlock) => client.getLogs({ address: market, event: swapEvent, fromBlock, toBlock, strict: true }));
      for (const log of logs) swaps.push({ blockNumber: log.blockNumber, logIndex: log.logIndex, hash: log.transactionHash, ...log.args });
    }
  }));
  if (!swaps.length) return [];
  const blocks = [...new Set(swaps.map(swap => swap.blockNumber))];
  const timestamps = new Map<bigint, number>();
  next = 0;
  await Promise.all(Array.from({ length: Math.min(scanConcurrency, blocks.length) }, async () => {
    while (next < blocks.length) {
      signal?.throwIfAborted();
      const number = blocks[next++];
      timestamps.set(number, Number((await client.getBlock({ blockNumber: number })).timestamp));
    }
  }));
  return buildTrades(swaps, timestamps);
}

function persistScan(key: string, cache: ScanCache) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(`stockback-history-v1:${key}`, JSON.stringify({ ...cache, timestamps: [...cache.timestamps] }, (_, value) => typeof value === "bigint" ? { bigint: value.toString() } : value));
  } catch { /* History still works when storage is full or unavailable. */ }
}

function restoreScan(key: string): ScanCache | undefined {
  if (typeof localStorage === "undefined") return;
  try {
    const value = localStorage.getItem(`stockback-history-v1:${key}`);
    if (!value) return;
    const cache = JSON.parse(value, (_, item) => item && typeof item === "object" && Object.keys(item).length === 1 && typeof item.bigint === "string" ? BigInt(item.bigint) : item);
    if (typeof cache.start !== "bigint" || typeof cache.through !== "bigint" || !Array.isArray(cache.transfers) || !Array.isArray(cache.swaps) || !Array.isArray(cache.timestamps)) return;
    return { ...cache, timestamps: new Map(cache.timestamps) };
  } catch { return; }
}

export async function readMarketActivity(client: PublicClient, chainId: number, market: Address, token: Address, earliest = 0n, options: ReadOptions = {}): Promise<MarketActivity> {
  const head = await client.getBlockNumber({ cacheTime: 0 });
  const tip = head > 2n ? head - 2n : head;
  const key = `${chainId}:${market.toLowerCase()}:${token.toLowerCase()}`;
  const old = scans.get(key) ?? restoreScan(key);
  const preview = (!old || old.through + 2000n < tip) && options.onPreview ? recentTrades(client, market, tip, options.signal).then(trades => {
    if (trades.length && !options.signal?.aborted) options.onPreview?.(trades);
  }).catch(() => { /* The complete scan reports its own errors. */ }) : undefined;
  const start = old?.start ?? await deploymentBlock(client, token, tip, earliest);
  const from = old && old.through <= tip ? (old.through > start + 16n ? old.through - 16n : start) : start;
  let transfers = old?.transfers.filter(log => log.blockNumber < from) ?? [];
  let swaps = old?.swaps.filter(log => log.blockNumber < from) ?? [];
  const timestamps = new Map(old?.timestamps);
  for (const number of timestamps.keys()) if (number >= from) timestamps.delete(number);
  options.onProgress?.(Number(from - start) / Number(tip - start + 1n) * 90);
  // The public provider permits 100 blocks per log request. Bounded parallel
  // reads hide RPC latency, while ordered checkpoints retain a complete prefix
  // if the user leaves the page or a request fails.
  const ranges: { from: bigint; to: bigint }[] = [];
  for (let cursor = from; cursor <= tip; cursor += scanWindow) ranges.push({ from: cursor, to: cursor + scanWindow - 1n < tip ? cursor + scanWindow - 1n : tip });
  const loadLogs = (fromBlock: bigint, toBlock: bigint) => client.getLogs({ address: [token, market], events: [transferEvent, swapEvent], fromBlock, toBlock, strict: true });
  let next = 0, committed = 0;
  let failure: unknown;
  const completed = new Map<number, Awaited<ReturnType<typeof loadLogs>>>();
  await Promise.all(Array.from({ length: Math.min(scanConcurrency, ranges.length) }, async () => {
    while (next < ranges.length && !failure) {
      const index = next++;
      const range = ranges[index];
      try {
        options.signal?.throwIfAborted();
        const logs = await readRange(range.from, range.to, loadLogs);
        if (failure) break;
        completed.set(index, logs);
        while (completed.has(committed)) {
          const ready = completed.get(committed)!;
          completed.delete(committed);
          for (const log of ready) {
            if (log.eventName === "Transfer" && log.address.toLowerCase() === token.toLowerCase()) transfers.push({ blockNumber: log.blockNumber, logIndex: log.logIndex, ...log.args });
            if (log.eventName === "Swap" && log.address.toLowerCase() === market.toLowerCase()) swaps.push({ blockNumber: log.blockNumber, logIndex: log.logIndex, hash: log.transactionHash, ...log.args });
          }
          const through = ranges[committed++].to;
          const cache = { start, through, transfers, swaps, timestamps };
          scans.set(key, cache);
          if (committed % 10 === 0 || committed === ranges.length) persistScan(key, cache);
          options.onProgress?.(Number(through - start + 1n) / Number(tip - start + 1n) * 90);
        }
      } catch (error) { failure ??= error; }
    }
  }));
  if (failure) {
    const cache = scans.get(key);
    if (cache && committed) persistScan(key, cache);
    throw failure;
  }
  void preview;
  const blocks = [...new Set([start, tip, ...swaps.map(swap => swap.blockNumber)])];
  const missing = blocks.filter(number => !timestamps.has(number));
  next = 0;
  let resolved = blocks.length - missing.length;
  await Promise.all(Array.from({ length: Math.min(scanConcurrency, missing.length) }, async () => {
    while (next < missing.length) {
      options.signal?.throwIfAborted();
      const blockNumber = missing[next++];
      timestamps.set(blockNumber, Number((await client.getBlock({ blockNumber })).timestamp));
      options.onProgress?.(90 + ++resolved / blocks.length * 10);
    }
  }));
  const activity = buildActivity(transfers, swaps, timestamps, market, tip, timestamps.get(tip)!);
  const cache = { start, through: tip, transfers, swaps, timestamps };
  scans.set(key, cache);
  persistScan(key, cache);
  return activity;
}
