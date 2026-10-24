"use client";

import { useMemo, useState } from "react";
import { Activity, ArrowDownLeft, ArrowUpRight, ChartCandlestick, Copy, ExternalLink, RefreshCw, Users } from "lucide-react";
import { CandlestickChart } from "./CandlestickChart";
import type { MarketActivity, MarketTrade } from "../lib/market-activity";
import { buildCandles } from "../lib/market-activity";
import type { TokenInfo } from "../types/ui";
import { Amount, Button, EmptyState, Panel, shortAddress } from "./ui";

const intervals = [["1m", 60], ["5m", 300], ["15m", 900], ["1h", 3600], ["4h", 14400], ["1D", 86400]] as const;
const number = (value: number) => new Intl.NumberFormat("en-US", { maximumSignificantDigits: 5 }).format(value);
const timeLabel = (time: number) => new Date(time * 1000).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });

export function MarketChart({ activity, previewTrades, pending, progress = 0, error, refreshing, refresh, symbol, quote }: { activity?: MarketActivity; previewTrades?: MarketTrade[]; pending: boolean; progress?: number; error?: string; refreshing: boolean; refresh: () => void; symbol: string; quote: TokenInfo }) {
  const [interval, setInterval] = useState(60);
  const trades = activity?.trades ?? previewTrades;
  const candles = useMemo(() => buildCandles(trades ?? [], interval), [trades, interval]);
  return <Panel title="Live market" className="sb-chart-panel" aside={<span className="sb-live-label"><span className="sb-dot" />{refreshing ? "Syncing" : "On-chain"}<button type="button" aria-label="Refresh market activity" disabled={refreshing} onClick={refresh}><RefreshCw size={13} className={refreshing ? "sb-spin" : ""} /></button></span>}>
    <div className="sb-chart-toolbar"><div role="group" aria-label="Chart timeframe">{intervals.map(([label, seconds]) => <button type="button" key={label} aria-pressed={interval === seconds} onClick={() => { setInterval(seconds); }}>{label}</button>)}</div><span>{quote.symbol} / {symbol}</span></div>
    {activity || previewTrades?.length ? <>
      {candles.length ? <CandlestickChart candles={candles} interval={interval} symbol={symbol} quote={quote.symbol} /> : <div className="sb-chart-empty"><ChartCandlestick size={40} /><h3>Waiting for the first trade</h3><p>The first confirmed swap starts this token’s price chart.</p></div>}
      <div className="sb-chart-caption">{activity ? `Block ${activity.blockNumber} · Updated ${timeLabel(activity.updatedAt)} UTC` : `Recent confirmed trades · Verifying full history ${progress}%`}{error && <span className="sb-negative"> · Sync paused: {error}</span>}</div>
    </> : <div className="sb-chart-empty"><ChartCandlestick size={40} /><h3>{error ? "Market history unavailable" : pending ? `Syncing token history · ${progress}%` : "Select a live market"}</h3><p>{error ?? "Loading confirmed trades and holders. The first sync can take a moment; live updates follow every 5 seconds."}</p>{error && <Button variant="secondary" onClick={refresh} disabled={refreshing}>Retry</Button>}</div>}
  </Panel>;
}

export function HolderTable({ activity, error, token, quote, price, explorer, copy }: { activity?: MarketActivity; error?: string; token: TokenInfo; quote: TokenInfo; price: string | null; explorer?: string; copy: (value: string) => void }) {
  return <Panel title="Top holders" className="sb-holders-panel" aside={<span className="sb-badge"><Users size={13} />{activity?.holderCount.toLocaleString() ?? "—"}</span>}>
    {!activity ? <EmptyState title={error ? "Holder data unavailable" : "Loading verified holders"} error={Boolean(error)}>{error ? "Retry the market history sync to load verified rankings." : "Rankings appear after the full token transfer history has been verified."}</EmptyState> : activity.holders.length === 0 ? <EmptyState title="No holders yet">Wallet holders appear after tokens leave the market reserve.</EmptyState> : <>
      <div className="sb-terminal-table-scroll"><table className="sb-terminal-table"><caption className="sb-sr-only">Top token holders, excluding market reserves</caption><thead><tr><th>Holder</th><th>Amount / supply</th><th>Value ({quote.symbol})</th><th><span className="sb-sr-only">Actions</span></th></tr></thead><tbody>{activity.holders.map((holder, index) => <tr key={holder.address}><td><span className="sb-holder-rank">{index + 1}</span>{explorer ? <a href={`${explorer}/address/${holder.address}`} target="_blank" rel="noopener noreferrer">{shortAddress(holder.address)}</a> : shortAddress(holder.address)}</td><td><strong><Amount value={holder.amount} digits={2} /></strong><small>{holder.share.toFixed(2)}% · {token.symbol}</small></td><td><strong>{price === null ? "—" : number(Number(holder.amount) * Number(price))}</strong><small>at current price</small></td><td><button type="button" aria-label={`Copy holder ${holder.address}`} onClick={() => copy(holder.address)}><Copy size={13} /></button></td></tr>)}</tbody></table></div>
      <div className="sb-chart-caption">Top {activity.holders.length} of {activity.holderCount.toLocaleString()} wallet holders · Market reserve excluded</div>
    </>}
  </Panel>;
}

export function RecentTrades({ activity, error, quote, explorer }: { activity?: MarketActivity; error?: string; quote: TokenInfo; explorer?: string }) {
  return <Panel title="Recent trades" className="sb-holders-panel" aside={<Activity size={15} className="sb-accent" />}>
    {!activity?.trades.length ? <EmptyState title={error ? "Trade history unavailable" : !activity ? "Loading recent trades" : "No confirmed trades to show"} error={Boolean(error)}>{error ? "Retry the market history sync to load confirmed trades." : "Confirmed buys and sells will appear here."}</EmptyState> : <div className="sb-terminal-table-scroll"><table className="sb-terminal-table"><thead><tr><th>Side / trader</th><th>Total ({quote.symbol})</th><th>Price</th><th>Time (UTC)</th></tr></thead><tbody>{activity.trades.slice(-30).reverse().map(trade => <tr key={trade.id}><td><span className={trade.isBuy ? "sb-positive" : "sb-negative"}>{trade.isBuy ? <ArrowDownLeft size={13} /> : <ArrowUpRight size={13} />}{trade.isBuy ? "Buy" : "Sell"}</span><small>{shortAddress(trade.trader)}</small></td><td><Amount value={trade.quoteAmount} /></td><td>{number(trade.price)}</td><td>{explorer ? <a href={`${explorer}/tx/${trade.hash}`} target="_blank" rel="noopener noreferrer">{timeLabel(trade.time)} <ExternalLink size={10} /></a> : timeLabel(trade.time)}</td></tr>)}</tbody></table></div>}
  </Panel>;
}
