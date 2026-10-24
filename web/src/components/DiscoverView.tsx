"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { ArrowDownWideNarrow, ArrowRight, Coins, Gift, Layers3, LockKeyhole, Search, ShieldCheck, Sparkles, X } from "lucide-react";
import type { ViewContext } from "./StockBackApp";
import { Amount, Button, EmptyState, LoadingState, TokenMark, atomic, positive } from "./ui";

type Filter = "all" | "holdings" | "rewards";
type Sort = "liquidity" | "name";

const HERO_CHART_PATH = "M90 278C180 285 176 214 252 230S334 293 400 223S458 131 517 157S583 226 644 145S717 62 768 105S831 134 910 39";

/** Discovery uses only supplied pool data. The hero artwork is decorative, not a price history. */
export function DiscoverView(context: ViewContext) {
  const { data, actions, busy, run, navigate } = context;
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
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
  const walletReady = data.wallet.status === "connected" && data.wallet.networkStatus === "correct"
    && data.wallet.balancesStatus === "ready";
  const needle = query.trim().toLowerCase();
  const markets = data.markets.filter((market) => {
    const match = `${market.token.name} ${market.token.symbol} ${market.id} ${market.token.id}`.toLowerCase().includes(needle);
    if (!match) return false;
    if (filter === "holdings") return walletReady && positive(market.walletBalance ?? "0", market.token.decimals);
    if (filter === "rewards") return walletReady && positive(market.claimableRewards ?? "0", data.stockToken.decimals);
    return true;
  }).sort((a, b) => {
    if (sort === "name") return a.token.name.localeCompare(b.token.name);
    const left = atomic(a.stockReserve, data.stockToken.decimals) ?? 0n;
    const right = atomic(b.stockReserve, data.stockToken.decimals) ?? 0n;
    return left === right ? a.token.name.localeCompare(b.token.name) : left > right ? -1 : 1;
  });

  return <div className="sb-discover">
    <section className="sb-hero" aria-labelledby="sb-discover-title">
      <div className="sb-hero-art" aria-hidden="true">
        <svg viewBox="0 0 900 350" preserveAspectRatio="xMidYMid slice" fill="none">
          <defs>
            <linearGradient id="sb-chart-fill" x1="450" y1="90" x2="450" y2="350" gradientUnits="userSpaceOnUse"><stop stopColor="#836ef9" stopOpacity=".18" /><stop offset="1" stopColor="#836ef9" stopOpacity="0" /></linearGradient>
            <linearGradient id="sb-chart-stroke" x1="100" y1="230" x2="880" y2="120" gradientUnits="userSpaceOnUse"><stop stopColor="#836ef9" stopOpacity="0" /><stop offset=".4" stopColor="#a999ff" /><stop offset="1" stopColor="#c1b6ff" /></linearGradient>
            <pattern id="sb-chart-grid" width="64" height="64" patternUnits="userSpaceOnUse"><path d="M64 0H0V64" stroke="#a999ff" strokeOpacity=".06" /></pattern>
          </defs>
          <rect width="900" height="350" fill="url(#sb-chart-grid)" />
          <path d={`${HERO_CHART_PATH}V350H90Z`} fill="url(#sb-chart-fill)" />
          <path d={HERO_CHART_PATH} stroke="#836ef9" strokeWidth="9" strokeOpacity=".1" />
          <path d={HERO_CHART_PATH} stroke="url(#sb-chart-stroke)" strokeWidth="2.5" />
          <g className="sb-hero-marker">
            <circle r="9" fill="#171322" stroke="#a999ff" /><circle r="3" fill="#c1b6ff" />
            <animateMotion path={HERO_CHART_PATH} dur="10s" repeatCount="indefinite"
              keyPoints="0.52;0.78;0.35;0.52" keyTimes="0;0.33;0.66;1"
              calcMode="spline" keySplines="0.42 0 0.58 1;0.42 0 0.58 1;0.42 0 0.58 1" />
          </g>
        </svg>
      </div>
      <div className="sb-hero-copy">
        <span className="sb-eyebrow"><span className="sb-dot sb-dot--purple" />MEMES MEET MARKETS</span>
        <h1 id="sb-discover-title">Big meme energy.<br /><span>Stock-backed markets.</span></h1>
        <p>Launch a meme. Trade against {data.stockToken.symbol}.<br className="sb-desktop-break" /> Share the fees with every move.</p>
        <Button onClick={() => navigate("launch")} disabled={busy}>Launch a coin<ArrowRight size={16} aria-hidden="true" /></Button>
        <div className="sb-hero-footnote"><LockKeyhole size={12} aria-hidden="true" />Fixed supply. Locked liquidity. Built on Monad.</div>
      </div>
      <div className="sb-hero-pair" aria-label="StockBack market model">
        <div className="sb-hero-pair-top"><span className="sb-pair-symbol"><Layers3 size={21} /></span><div><strong>MEME <span>×</span> {data.stockToken.symbol}</strong><small>One pair. A shared upside.</small></div><ArrowRight size={16} /></div>
      </div>
    </section>

    <section className="sb-market-discovery" aria-labelledby="sb-markets-title">
      <div className="sb-discovery-tools">
        <div className="sb-search-field"><Search size={16} aria-hidden="true" /><label className="sb-sr-only" htmlFor={searchId}>Search markets</label><input ref={search} id={searchId} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name, ticker, or market address" /><kbd>Ctrl K</kbd>{query && <button type="button" aria-label="Clear search" onClick={() => setQuery("")}><X size={14} /></button>}</div>
        <div className="sb-sort" role="group" aria-label="Sort markets"><span><ArrowDownWideNarrow size={14} aria-hidden="true" />Sort by</span><button type="button" aria-pressed={sort === "liquidity"} onClick={() => setSort("liquidity")}>Stock liquidity</button><button type="button" aria-pressed={sort === "name"} onClick={() => setSort("name")}>Name</button></div>
      </div>
      <div className="sb-discovery-filters"><div role="group" aria-label="Filter markets"><span className="sb-filter-label">Explore</span>{([{ id: "all", label: "All markets", icon: Layers3 }, { id: "holdings", label: "My holdings", icon: Coins }, { id: "rewards", label: "Rewards ready", icon: Gift }] as const).map(({ id, label, icon: Icon }) => <button key={id} type="button" aria-pressed={filter === id} onClick={() => setFilter(id)}><Icon size={14} aria-hidden="true" />{label}</button>)}</div><span className="sb-pair-filter"><span className="sb-dot sb-dot--purple" />Paired with <strong>{data.stockToken.symbol}</strong></span></div>
      <div className="sb-market-section-heading"><h2 id="sb-markets-title">{filter === "holdings" ? "Your holdings" : filter === "rewards" ? "Claimable rewards" : "Explore the markets"}<span>{data.marketsStatus === "ready" ? markets.length : "—"}</span></h2><span><ShieldCheck size={13} aria-hidden="true" />Testnet assets only</span></div>
      {data.marketsStatus === "loading" ? <LoadingState label="Loading markets" /> : data.marketsStatus === "error" ? <EmptyState title="Markets unavailable" error>{data.marketsError ?? "Market data could not be loaded."}</EmptyState> : markets.length === 0 ? <div className="sb-discovery-empty"><EmptyState title={query ? "No matching markets" : filter !== "all" ? "Nothing here yet" : "Be the first to launch"}>{query ? "Try another name, ticker, or market address." : filter !== "all" ? "Connect your wallet on Monad Testnet to explore your balances and rewards." : `Create a coin and start the first ${data.stockToken.symbol} market.`}</EmptyState><Button variant="secondary" onClick={() => { setQuery(""); setFilter("all"); if (data.markets.length === 0) navigate("launch"); }}>{data.markets.length === 0 ? "Launch a coin" : "Show all markets"}<ArrowRight size={14} aria-hidden="true" /></Button></div> : <div className="sb-market-grid">{markets.map((market, index) => <button type="button" className="sb-market-card" key={market.id} disabled={busy} aria-label={`Trade ${market.token.symbol}`} onClick={() => { run(() => actions.selectMarket(market.id)); navigate("trading"); }}>
        <div className="sb-card-top"><span className={`sb-card-avatar sb-card-avatar--${index % 4}`}>{market.token.image ? <img className="sb-token-art" src={market.token.image} alt="" width={44} height={44} /> : <TokenMark symbol={market.token.symbol} />}</span><span className="sb-rewards-tag"><Gift size={12} aria-hidden="true" />Holder rewards</span><ArrowRight size={16} className="sb-card-arrow" aria-hidden="true" /></div>
        <div className="sb-card-identity"><strong>${market.token.symbol}</strong><span>{market.token.name}</span></div>
        <div className="sb-card-pair">Paired with <span className="sb-stock-mini">S</span><strong>{data.stockToken.symbol}</strong><span className="sb-card-chain">MONAD</span></div>
        <div className="sb-card-stats"><div><span>Stock liquidity</span><strong><Amount value={market.stockReserve} digits={2} /><small>{data.stockToken.symbol}</small></strong></div><div><span>Token price</span><strong><Amount value={market.estimatedPrice} digits={6} /></strong></div></div>
        <div className="sb-card-bottom"><span><span className="sb-dot sb-dot--purple" />{(market.tradingFeeBps ?? 100) / 100}% trading fee</span><span>Trade pair<ArrowRight size={12} aria-hidden="true" /></span></div>
      </button>)}</div>}
    </section>

    <section className="sb-discover-rewards" aria-label="Trading fee distribution"><div className="sb-rewards-intro"><span className="sb-eyebrow"><Sparkles size={13} aria-hidden="true" />EVERY TRADE GIVES BACK</span><h2>A little fee.<br />A shared reward.</h2><p>Every trade pays its market’s 1% or 3% fee in {data.stockToken.symbol}.<br />Here is where it goes.</p></div><div className="sb-share"><span>01 / HOLDERS</span><strong>40<small>%</small></strong><p>For the people holding the meme.</p><div style={{ "--share": "40%" } as CSSProperties} /></div><div className="sb-share"><span>02 / STOCKVAULT</span><strong>10<small>%</small></strong><p>For the people locking {data.stockToken.symbol}.</p><div style={{ "--share": "10%" } as CSSProperties} /></div><div className="sb-share"><span>03 / TREASURY</span><strong>50<small>%</small></strong><p>For the protocol behind the markets.</p><div style={{ "--share": "50%" } as CSSProperties} /></div></section>
  </div>;
}
