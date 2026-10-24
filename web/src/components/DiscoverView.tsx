"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { formatUnits } from "viem";
import GradientASCII from "./GradientASCII";
import { ArrowDownWideNarrow, ArrowRight, Check, Copy, Gift, LockKeyhole, Search, ShieldCheck, X } from "lucide-react";
import type { ViewContext } from "./StockBackApp";
import { Amount, Button, EmptyState, LoadingState, QuoteAssetLogo, TokenMark, atomic } from "./ui";

type Sort = "liquidity" | "name";

const HERO_CHART_PATH = "M90 278C180 285 176 214 252 230S334 293 400 223S458 131 517 157S583 226 644 145S717 62 768 105S831 134 910 39";

/** Discovery uses only supplied pool data. The hero artwork is decorative, not a price history. */
export function DiscoverView(context: ViewContext) {
  const { data, actions, busy, run, navigate } = context;
  const [query, setQuery] = useState("");
  const [pairId, setPairId] = useState("all");
  const [assetQuery, setAssetQuery] = useState("");
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  const [sort, setSort] = useState<Sort>("liquidity");
  const search = useRef<HTMLInputElement>(null);
  const searchId = useId();
  useEffect(() => {
    function shortcut(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        search.current?.focus();
      }
    }
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, []);
  const pairAssets = Array.from(new Map([
    ...(data.quoteAssets ?? []),
    ...data.markets.map(market => market.stockToken ?? data.stockToken),
  ].map(asset => [asset.id.toLowerCase(), asset])).values());
  const assetNeedle = assetQuery.trim().toLowerCase();
  const needle = query.trim().toLowerCase();
  const markets = data.markets.filter((market) => {
    const match = `${market.token.name} ${market.token.symbol} ${market.id} ${market.token.id}`.toLowerCase().includes(needle);
    if (!match) return false;
    const asset = market.stockToken ?? data.stockToken;
    if (pairId !== "all" && asset.id.toLowerCase() !== pairId) return false;
    if (!`${asset.name} ${asset.symbol} ${asset.id}`.toLowerCase().includes(assetNeedle)) return false;
    return true;
  }).sort((a, b) => {
    if (sort === "name") return a.token.name.localeCompare(b.token.name);
    const left = atomic(a.stockReserve, (a.stockToken ?? data.stockToken).decimals) ?? 0n;
    const right = atomic(b.stockReserve, (b.stockToken ?? data.stockToken).decimals) ?? 0n;
    return left === right ? a.token.name.localeCompare(b.token.name) : left > right ? -1 : 1;
  });

  const walletReady = data.wallet.status === "connected" && data.wallet.networkStatus === "correct" && data.wallet.balancesStatus === "ready";
  const selectedMarkets = data.markets.filter(market => (market.stockToken ?? data.stockToken).id.toLowerCase() === data.stockToken.id.toLowerCase());
  const marketDataReady = data.marketsStatus === "ready";
  const liquidity = marketDataReady ? formatUnits(selectedMarkets.reduce((sum, market) => sum + (atomic(market.stockReserve, data.stockToken.decimals) ?? 0n), 0n), data.stockToken.decimals) : null;
  return <div className="sb-discover">
    <section className="sb-hero sb-market-hero" aria-labelledby="sb-discover-title">
      <div className="sb-hero-copy">
        <h1 id="sb-discover-title">Big meme energy.<br />Curve-powered markets.</h1>
        <p>Launch a meme. Trade against stock assets.<br />Share the fees with every move.</p>
        <Button onClick={() => navigate("launch")} disabled={busy}>Launch a coin<ArrowRight size={16} aria-hidden="true" /></Button>
        <p className="sb-market-hero-note"><LockKeyhole size={14} aria-hidden="true" />Fixed supply. Locked liquidity. Built on Monad.</p>
      </div>
      <div className="sb-market-hero-art" aria-hidden="true">
        <GradientASCII colors={["#2458bc", "#f6f8ff", "#a5d8ff", "#38bdf8"]} shape="horizon" characters=" =+xX0S8#@" cellSize={14} density={0.8} lightMode glow={0} depthOfField={0} glyphOpacity={0.8} gradientOpacity={0.7} softness={0.5} grain={0.01} speed={0.45} flow={0.35} dpr={2} />
      </div>
      <div className="sb-hero-pair" aria-label="StockBack market model">
        <div className="sb-hero-pair-top"><QuoteAssetLogo token={data.stockToken} /><div><strong>MEME / {data.stockToken.symbol}</strong><small>One pair. A shared upside.</small></div></div>
      </div>
    </section>
    <h2 className="sb-market-overview-title">Market overview</h2>
    <section className="sb-overview-metrics" aria-label="Selected asset market summary">
      <div><span>Markets in {data.stockToken.symbol}</span><strong>{marketDataReady ? selectedMarkets.length : "—"}</strong><small>Registered trading pairs</small></div>
      <div><span>Total pool liquidity</span><strong><Amount value={liquidity} digits={2} /><small>{data.stockToken.symbol}</small></strong><small>Sum of current stock reserves</small></div>
      <div><span>Your available balance</span><strong><Amount value={walletReady ? data.wallet.stockBalance : null} digits={2} /><small>{data.stockToken.symbol}</small></strong><small>{walletReady ? "Available in your wallet" : "Connect your wallet to view"}</small></div>
    </section>

    <section className="sb-market-discovery" aria-labelledby="sb-markets-title">
      <div className="sb-discovery-tools">
        <div className="sb-search-field"><Search size={16} aria-hidden="true" /><label className="sb-sr-only" htmlFor={searchId}>Search markets</label><input ref={search} id={searchId} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name, ticker, or contract address" /><kbd>Ctrl K</kbd>{query && <button type="button" aria-label="Clear search" onClick={() => setQuery("")}><X size={14} /></button>}</div>
        <div className="sb-sort" role="group" aria-label="Sort markets"><span><ArrowDownWideNarrow size={14} aria-hidden="true" />Sort by</span><button type="button" aria-pressed={sort === "liquidity"} onClick={() => setSort("liquidity")}>Quote backing</button><button type="button" aria-pressed={sort === "name"} onClick={() => setSort("name")}>Name</button></div>
      </div>
      <div className="sb-discovery-filters">
        <div className="sb-pair-options" role="group" aria-label="Filter by pair asset">
          <span className="sb-filter-label">Paired with</span>
          <button type="button" aria-pressed={pairId === "all"} onClick={() => { setPairId("all"); setAssetQuery(""); }}>All</button>
          {pairAssets.map(asset => <button key={asset.id} type="button" aria-pressed={pairId === asset.id.toLowerCase()} onClick={() => { setPairId(asset.id.toLowerCase()); setAssetQuery(""); }}><QuoteAssetLogo token={asset} small />{asset.symbol}</button>)}
        </div>
        <div className="sb-search-field sb-asset-search"><Search size={15} aria-hidden="true" /><label className="sb-sr-only" htmlFor={`${searchId}-asset`}>Find a pair asset</label><input id={`${searchId}-asset`} value={assetQuery} onChange={event => setAssetQuery(event.target.value)} placeholder="Find an asset" />{assetQuery && <button type="button" aria-label="Clear asset search" onClick={() => setAssetQuery("")}><X size={14} /></button>}</div>
      </div>
      <div className="sb-market-section-heading"><h2 id="sb-markets-title">All tokens<span>{data.marketsStatus === "ready" ? markets.length : "—"}</span></h2><span><ShieldCheck size={13} aria-hidden="true" />Testnet assets only</span></div>
      {data.marketsStatus === "loading" ? <LoadingState label="Loading markets" /> : data.marketsStatus === "error" ? <EmptyState title="Markets unavailable" error>{data.marketsError ?? "Market data could not be loaded."}</EmptyState> : markets.length === 0 ? <div className="sb-discovery-empty"><EmptyState title={query || assetQuery || pairId !== "all" ? "No matching markets" : "Be the first to launch"}>{query || assetQuery || pairId !== "all" ? "Try another search or select All to explore every pair." : "Create a coin and start a bonding curve."}</EmptyState><Button variant="secondary" onClick={() => { setQuery(""); setPairId("all"); setAssetQuery(""); if (data.markets.length === 0) navigate("launch"); }}>{data.markets.length === 0 ? "Launch a coin" : "Show all markets"}<ArrowRight size={14} aria-hidden="true" /></Button></div> : <div className="sb-market-grid">{markets.map((market, index) => <article className="sb-market-card" key={market.id}>
        <button type="button" className="sb-card-open" disabled={busy} aria-label={`Trade ${market.token.symbol}`} onClick={() => { run(() => actions.selectMarket(market.id)); navigate("trading"); }} />
        <div className="sb-card-top">
          <span className={`sb-card-avatar sb-card-avatar--${index % 4}`}>{market.token.image ? <img className="sb-token-art" src={market.token.image} alt="" width={52} height={52} /> : <TokenMark symbol={market.token.symbol} />}</span>
          <div className="sb-card-actions"><span className="sb-card-reward-icon" title="Token holders share trading fees" aria-label="Holder rewards"><Gift size={15} aria-hidden="true" /></span><button type="button" className="sb-card-copy" disabled={busy} aria-label={`Copy ${market.token.symbol} contract address`} title={market.token.id} onClick={() => run(async () => { await navigator.clipboard.writeText(market.token.id); setCopiedToken(market.token.id); })}>{copiedToken === market.token.id ? <><Check size={12} aria-hidden="true" />Copied</> : <>CA<Copy size={12} aria-hidden="true" /></>}</button></div>
        </div>
        <div className="sb-card-identity"><strong>${market.token.symbol}</strong><span>{market.token.name}</span></div>
        <div className="sb-card-value"><span>{market.bondingCurve ? "Curve backing" : "Quote reserve"}</span><strong><Amount value={market.stockReserve} digits={2} /></strong></div>
        <div className="sb-card-pair">Paired with <QuoteAssetLogo token={market.stockToken ?? data.stockToken} small /><strong>{(market.stockToken ?? data.stockToken).symbol}</strong><span className="sb-card-chain">MONAD</span></div>
        <div className="sb-card-bottom"><span className="sb-card-price">Price <Amount value={market.estimatedPrice} digits={6} /><small>{(market.stockToken ?? data.stockToken).symbol}</small></span><span>{(market.tradingFeeBps ?? 100) / 100}% fee<ArrowRight size={13} aria-hidden="true" /></span></div>
        <div className="sb-card-pair-art" aria-hidden="true"><QuoteAssetLogo token={market.stockToken ?? data.stockToken} /></div>
      </article>)}</div>}
    </section>

    <section className="sb-discover-rewards" aria-label="Trading fee distribution"><div className="sb-rewards-intro"><h2>Trading fee distribution</h2><p>Every trade pays its market’s 1% or 3% fee in its pair asset.<br />Here is where it goes.</p></div><div className="sb-share"><span>Token holders</span><strong>40<small>%</small></strong><p>For the people holding the meme.</p><div style={{ "--share": "40%" } as CSSProperties} /></div><div className="sb-share"><span>StockVault</span><strong>10<small>%</small></strong><p>For the people locking stock assets.</p><div style={{ "--share": "10%" } as CSSProperties} /></div><div className="sb-share"><span>Protocol treasury</span><strong>50<small>%</small></strong><p>For the protocol behind the markets.</p><div style={{ "--share": "50%" } as CSSProperties} /></div></section>
  </div>;
}
