"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { ArrowDownWideNarrow, ArrowRight, Check, Coins, Gift, Layers3, LockKeyhole, Plus, Search, ShieldCheck, Sparkles, X } from "lucide-react";
import type { ViewContext } from "./StockBackApp";
import { Amount, Button, EmptyState, LoadingState, TokenMark, atomic, canSpend, positive } from "./ui";

type Filter = "all" | "holdings" | "rewards";
type Sort = "liquidity" | "name";

/** Discovery uses only supplied pool data. The hero artwork is decorative, not a price history. */
export function DiscoverView(context: ViewContext) {
  const { data, actions, busy, run, navigate, setLaunchOpen } = context;
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
          <path d="M90 278C180 285 176 214 252 230S334 293 400 223S458 131 517 157S583 226 644 145S717 62 768 105S831 134 910 39V350H90Z" fill="url(#sb-chart-fill)" />
          <path d="M90 278C180 285 176 214 252 230S334 293 400 223S458 131 517 157S583 226 644 145S717 62 768 105S831 134 910 39" stroke="#836ef9" strokeWidth="9" strokeOpacity=".1" />
          <path d="M90 278C180 285 176 214 252 230S334 293 400 223S458 131 517 157S583 226 644 145S717 62 768 105S831 134 910 39" stroke="url(#sb-chart-stroke)" strokeWidth="2.5" />
          <circle cx="517" cy="157" r="9" fill="#171322" stroke="#a999ff" /><circle cx="517" cy="157" r="3" fill="#c1b6ff" />
        </svg>
      </div>
      <div className="sb-hero-copy">
        <span className="sb-eyebrow"><span className="sb-dot sb-dot--purple" />MEMES MEET MARKETS</span>
        <h1 id="sb-discover-title">Big meme energy.<br /><span>Stock-backed markets.</span></h1>
        <p>Launch a meme. Trade against MockSPYx.<br className="sb-desktop-break" /> Share the fees with every move.</p>
        <Button onClick={() => setLaunchOpen(true)} disabled={busy}>Launch a coin<ArrowRight size={16} aria-hidden="true" /></Button>
        <div className="sb-hero-footnote"><LockKeyhole size={12} aria-hidden="true" />Fixed supply. Locked liquidity. Built on Monad.</div>
      </div>
      <div className="sb-hero-pair" aria-label="StockBack market model">
        <div className="sb-hero-pair-top"><span className="sb-pair-symbol"><Layers3 size={21} /></span><div><strong>MEME <span>×</span> MockSPYx</strong><small>One pair. A shared upside.</small></div><ArrowRight size={16} /></div>
        <div className="sb-hero-pair-bottom"><span><strong>1%</strong> trading fee</span><span><Gift size={13} aria-hidden="true" />40% to holders</span></div>
      </div>
    </section>

    <section className="sb-market-discovery" aria-labelledby="sb-markets-title">
      <div className="sb-discovery-tools">
        <div className="sb-search-field"><Search size={16} aria-hidden="true" /><label className="sb-sr-only" htmlFor={searchId}>Search markets</label><input ref={search} id={searchId} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name, ticker, or market address" /><kbd>Ctrl K</kbd>{query && <button type="button" aria-label="Clear search" onClick={() => setQuery("")}><X size={14} /></button>}</div>
        <div className="sb-sort" role="group" aria-label="Sort markets"><span><ArrowDownWideNarrow size={14} aria-hidden="true" />Sort by</span><button type="button" aria-pressed={sort === "liquidity"} onClick={() => setSort("liquidity")}>Stock liquidity</button><button type="button" aria-pressed={sort === "name"} onClick={() => setSort("name")}>Name</button></div>
      </div>
      <div className="sb-discovery-filters"><div role="group" aria-label="Filter markets"><span className="sb-filter-label">Explore</span>{([{ id: "all", label: "All markets", icon: Layers3 }, { id: "holdings", label: "My holdings", icon: Coins }, { id: "rewards", label: "Rewards ready", icon: Gift }] as const).map(({ id, label, icon: Icon }) => <button key={id} type="button" aria-pressed={filter === id} onClick={() => setFilter(id)}><Icon size={14} aria-hidden="true" />{label}</button>)}</div><span className="sb-pair-filter"><span className="sb-dot sb-dot--purple" />Paired with <strong>MockSPYx</strong></span></div>
      <div className="sb-market-section-heading"><h2 id="sb-markets-title">{filter === "holdings" ? "Your holdings" : filter === "rewards" ? "Claimable rewards" : "Explore the markets"}<span>{data.marketsStatus === "ready" ? markets.length : "—"}</span></h2><span><ShieldCheck size={13} aria-hidden="true" />Testnet assets only</span></div>
      {data.marketsStatus === "loading" ? <LoadingState label="Loading markets" /> : data.marketsStatus === "error" ? <EmptyState title="Markets unavailable" error>{data.marketsError ?? "Market data could not be loaded."}</EmptyState> : markets.length === 0 ? <div className="sb-discovery-empty"><EmptyState title={query ? "No matching markets" : filter !== "all" ? "Nothing here yet" : "Be the first to launch"}>{query ? "Try another name, ticker, or market address." : filter !== "all" ? "Connect your wallet on Monad Testnet to explore your balances and rewards." : "Create a coin and start the first MockSPYx market."}</EmptyState><Button variant="secondary" onClick={() => { setQuery(""); setFilter("all"); if (data.markets.length === 0) setLaunchOpen(true); }}>{data.markets.length === 0 ? "Launch a coin" : "Show all markets"}<ArrowRight size={14} aria-hidden="true" /></Button></div> : <div className="sb-market-grid">{markets.map((market, index) => <button type="button" className="sb-market-card" key={market.id} disabled={busy} aria-label={`Trade ${market.token.symbol}`} onClick={() => { run(() => actions.selectMarket(market.id)); navigate("trading"); }}>
        <div className="sb-card-top"><span className={`sb-card-avatar sb-card-avatar--${index % 4}`}><TokenMark symbol={market.token.symbol} /></span><span className="sb-rewards-tag"><Gift size={12} aria-hidden="true" />Holder rewards</span><ArrowRight size={16} className="sb-card-arrow" aria-hidden="true" /></div>
        <div className="sb-card-identity"><strong>${market.token.symbol}</strong><span>{market.token.name}</span></div>
        <div className="sb-card-pair">Paired with <span className="sb-stock-mini">S</span><strong>MockSPYx</strong><span className="sb-card-chain">MONAD</span></div>
        <div className="sb-card-stats"><div><span>Stock liquidity</span><strong><Amount value={market.stockReserve} digits={2} /><small>MockSPYx</small></strong></div><div><span>Token price</span><strong><Amount value={market.estimatedPrice} digits={6} /></strong></div></div>
        <div className="sb-card-bottom"><span><span className="sb-dot sb-dot--purple" />1% trading fee</span><span>Trade pair<ArrowRight size={12} aria-hidden="true" /></span></div>
      </button>)}</div>}
    </section>

    <section className="sb-discover-rewards" aria-label="Trading fee distribution"><div className="sb-rewards-intro"><span className="sb-eyebrow"><Sparkles size={13} aria-hidden="true" />EVERY TRADE GIVES BACK</span><h2>A little fee.<br />A shared reward.</h2><p>Every trade pays a 1% fee in MockSPYx.<br />Here is where it goes.</p></div><div className="sb-share"><span>01 / HOLDERS</span><strong>40<small>%</small></strong><p>For the people holding the meme.</p><div style={{ "--share": "40%" } as CSSProperties} /></div><div className="sb-share"><span>02 / STOCKVAULT</span><strong>10<small>%</small></strong><p>For the people locking MockSPYx.</p><div style={{ "--share": "10%" } as CSSProperties} /></div><div className="sb-share"><span>03 / TREASURY</span><strong>50<small>%</small></strong><p>For the protocol behind the markets.</p><div style={{ "--share": "50%" } as CSSProperties} /></div></section>
    <CoinLaunchDialog {...context} />
  </div>;
}

function CoinLaunchDialog({ data, actions, ready, busy, run, launchOpen, setLaunchOpen }: ViewContext) {
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [liquidity, setLiquidity] = useState("");
  const [launchError, setLaunchError] = useState<string | null>(null);
  useEffect(() => {
    if (launchOpen && !dialog.current?.open) dialog.current?.showModal();
    if (!launchOpen && dialog.current?.open) dialog.current.close();
  }, [launchOpen]);
  const balanceReady = ready && data.wallet.balancesStatus === "ready";
  const sufficient = balanceReady && canSpend(liquidity, data.wallet.stockBalance, data.stockToken.decimals);
  const valid = name.trim().length > 0 && /^[A-Z0-9]{1,12}$/.test(symbol) && sufficient;
  return <dialog ref={dialog} className="sb-launch-dialog" aria-labelledby={`${id}-title`} onClose={() => setLaunchOpen(false)} onCancel={(event) => { if (busy) event.preventDefault(); else setLaunchOpen(false); }}>
    <div className="sb-dialog-heading"><span className="sb-pair-symbol"><Plus size={22} aria-hidden="true" /></span><button type="button" aria-label="Close launch form" disabled={busy} onClick={() => setLaunchOpen(false)}><X size={19} /></button></div>
    <span className="sb-eyebrow">YOUR NEXT BIG IDEA</span><h2 id={`${id}-title`}>Launch your coin.</h2><p className="sb-dialog-description">One million tokens. Your own MockSPYx market.</p>
    <form className="sb-form" onSubmit={(event) => { event.preventDefault(); if (valid && ready && !busy) run(async () => { setLaunchError(null); try { await actions.createCoin({ name: name.trim(), symbol, initialStockLiquidity: liquidity }); } catch (error) { setLaunchError(error instanceof Error ? error.message : "Creation could not complete. Please try again."); throw error; } }); }}>
      <div className="sb-field"><label htmlFor={`${id}-name`}>Token name</label><input id={`${id}-name`} placeholder="e.g. Market Cat" value={name} onChange={(event) => setName(event.target.value)} maxLength={48} required disabled={busy} /></div>
      <div className="sb-field"><label htmlFor={`${id}-symbol`}>Ticker</label><div className="sb-input-with-prefix"><span>$</span><input id={`${id}-symbol`} placeholder="MCAT" value={symbol} onChange={(event) => setSymbol(event.target.value.toUpperCase())} pattern="[A-Z0-9]{1,12}" maxLength={12} required disabled={busy} /></div><small>1–12 letters or numbers.</small></div>
      <div className="sb-field"><label htmlFor={`${id}-liquidity`}>Initial stock liquidity</label><div className="sb-input-with-unit"><input id={`${id}-liquidity`} inputMode="decimal" value={liquidity} onChange={(event) => setLiquidity(event.target.value)} placeholder="0.00" required disabled={busy} aria-describedby={`${id}-help`} /><span>MockSPYx</span></div><small id={`${id}-help`}>{liquidity && !positive(liquidity, data.stockToken.decimals) ? "Enter a positive amount with up to 18 decimals." : balanceReady && positive(liquidity, data.stockToken.decimals) && !sufficient ? "Insufficient MockSPYx balance." : <>Available: <Amount value={balanceReady ? data.wallet.stockBalance : null} /> MockSPYx</>}</small></div>
      <div className="sb-launch-summary"><span><Check size={14} aria-hidden="true" />1,000,000 fixed supply</span><span><LockKeyhole size={14} aria-hidden="true" />Liquidity is permanently locked</span><span><Gift size={14} aria-hidden="true" />40% of trading fees to holders</span></div>
      {!ready && <p className="sb-input-help">Connect your wallet on Monad Testnet to launch.</p>}
      {launchError && <p role="alert" className="sb-negative">{launchError}</p>}
      {data.transaction.status === "pending" && <p role="status" className="sb-input-help">{data.transaction.label ?? "Waiting for wallet confirmation…"}</p>}
      {data.transaction.status === "success" && <p role="status">Transaction confirmed. Your market data will update after confirmation.</p>}
      <Button type="submit" className="sb-full" disabled={!ready || !valid || busy}>Create coin<ArrowRight size={15} aria-hidden="true" /></Button>
      <small className="sb-centered sb-muted">{busy ? "Complete the current wallet action first." : "Approval and creation require wallet confirmation."}</small>
    </form>
  </dialog>;
}
