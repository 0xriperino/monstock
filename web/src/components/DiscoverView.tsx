"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { formatUnits } from "viem";
import { ArrowDownWideNarrow, ArrowRight, Check, Coins, Copy, Gift, Layers3, LockKeyhole, Search, ShieldCheck, X } from "lucide-react";
import type { ViewContext } from "./StockBackApp";
import { Amount, Button, EmptyState, LoadingState, QuoteAssetLogo, TokenMark, atomic, positive } from "./ui";
import GradientASCII from "./GradientASCII";

type Filter = "all" | "holdings" | "rewards";
type Sort = "liquidity" | "name";

/** Market figures are derived only from supplied on-chain pool data. */
export function DiscoverView(context: ViewContext) {
  const { data, actions, busy, run, navigate } = context;
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [pairAsset, setPairAsset] = useState("all");
  const [sort, setSort] = useState<Sort>("liquidity");
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);
  useEffect(() => {
    if (!copiedToken) return;
    const timer = window.setTimeout(() => setCopiedToken(null), 2000);
    return () => window.clearTimeout(timer);
  }, [copiedToken]);
  async function copyTokenAddress(address: string) {
    setCopyError(null);
    try {
      await navigator.clipboard.writeText(address);
      setCopiedToken(address);
    } catch {
      setCopyError(`Could not copy the token address. ${address}`);
    }
  }
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
  const availableMarkets = data.discovery?.markets ?? data.markets;
  const discoveryStatus = data.discovery?.status ?? data.marketsStatus;
  const discoveryError = data.discovery?.error ?? data.marketsError;
  const pairAssets = data.quoteAssets ?? [data.stockToken];
  const markets = availableMarkets.filter((market) => {
    const quoteAsset = market.stockToken ?? data.stockToken;
    if (pairAsset !== "all" && quoteAsset.id.toLowerCase() !== pairAsset.toLowerCase()) return false;
    const match = `${market.token.name} ${market.token.symbol} ${market.id} ${market.token.id}`.toLowerCase().includes(needle);
    if (!match) return false;
    if (filter === "holdings") return walletReady && positive(market.walletBalance ?? "0", market.token.decimals);
    if (filter === "rewards") return walletReady && positive(market.claimableRewards ?? "0", quoteAsset.decimals);
    return true;
  }).sort((a, b) => {
    if (sort === "name") return a.token.name.localeCompare(b.token.name);
    const leftAsset = a.stockToken ?? data.stockToken;
    const rightAsset = b.stockToken ?? data.stockToken;
    // Different quote units cannot be ranked as one financial amount.
    if (leftAsset.id.toLowerCase() !== rightAsset.id.toLowerCase()) return leftAsset.symbol.localeCompare(rightAsset.symbol);
    const left = atomic(a.stockReserve, leftAsset.decimals) ?? 0n;
    const right = atomic(b.stockReserve, rightAsset.decimals) ?? 0n;
    return left === right ? a.token.name.localeCompare(b.token.name) : left > right ? -1 : 1;
  });

  const marketDataReady = data.marketsStatus === "ready";
  const liquidity = marketDataReady ? formatUnits(data.markets.reduce((sum, market) => sum + (atomic(market.stockReserve, data.stockToken.decimals) ?? 0n), 0n), data.stockToken.decimals) : null;

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
      <div><span>Markets in {data.stockToken.symbol}</span><strong>{marketDataReady ? data.markets.length : "—"}</strong><small>Registered trading pairs</small></div>
      <div><span>Total pool liquidity</span><strong><Amount value={liquidity} digits={2} /><small>{data.stockToken.symbol}</small></strong><small>Sum of current stock reserves</small></div>
      <div><span>Your available balance</span><strong><Amount value={walletReady ? data.wallet.stockBalance : null} digits={2} /><small>{data.stockToken.symbol}</small></strong><small>{walletReady ? "Available in your wallet" : "Connect your wallet to view"}</small></div>
    </section>

    <section className="sb-market-discovery" aria-labelledby="sb-markets-title">
      <div className="sb-paired-assets" role="group" aria-label="Filter by pair asset">
        <span>Paired with</span>
        <button type="button" aria-pressed={pairAsset === "all"} onClick={() => setPairAsset("all")}>All</button>
        {pairAssets.map(asset => <button type="button" key={asset.id} aria-pressed={pairAsset.toLowerCase() === asset.id.toLowerCase()} onClick={() => setPairAsset(asset.id)}><QuoteAssetLogo token={asset} small />{asset.symbol}</button>)}
      </div>
      <div className="sb-discovery-tools">
        <div className="sb-search-field"><Search size={16} aria-hidden="true" /><label className="sb-sr-only" htmlFor={searchId}>Search markets</label><input ref={search} id={searchId} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name, ticker, or market address" /><kbd>Ctrl K</kbd>{query && <button type="button" aria-label="Clear search" onClick={() => setQuery("")}><X size={14} /></button>}</div>
        <div className="sb-sort" role="group" aria-label="Sort markets"><span><ArrowDownWideNarrow size={14} aria-hidden="true" />Sort by</span><button type="button" aria-pressed={sort === "liquidity"} onClick={() => setSort("liquidity")}>Stock liquidity</button><button type="button" aria-pressed={sort === "name"} onClick={() => setSort("name")}>Name</button></div>
      </div>
      <div className="sb-discovery-filters"><div role="group" aria-label="Filter markets"><span className="sb-filter-label">Explore</span>{([{ id: "all", label: "All markets", icon: Layers3 }, { id: "holdings", label: "My holdings", icon: Coins }, { id: "rewards", label: "Rewards ready", icon: Gift }] as const).map(({ id, label, icon: Icon }) => <button key={id} type="button" aria-pressed={filter === id} onClick={() => setFilter(id)}><Icon size={14} aria-hidden="true" />{label}</button>)}</div><span className="sb-pair-filter"><span className="sb-dot sb-dot--purple" />Paired with <strong>{data.stockToken.symbol}</strong></span></div>
      <div className="sb-market-section-heading"><h2 id="sb-markets-title">{filter === "holdings" ? "Your holdings" : filter === "rewards" ? "Claimable rewards" : "All tokens"}<span>{discoveryStatus === "ready" ? markets.length : "—"}</span></h2><span><ShieldCheck size={13} aria-hidden="true" />Testnet assets only</span></div>
      <span className="sb-sr-only" role="status">{copiedToken ? "Token address copied" : ""}</span>
      {copyError && <p className="sb-negative sb-copy-error" role="alert">{copyError}</p>}
      {discoveryStatus === "loading" ? <LoadingState label="Loading markets" /> : discoveryStatus === "error" ? <EmptyState title="Markets unavailable" error>{discoveryError ?? "Market data could not be loaded."}</EmptyState> : markets.length === 0 ? <div className="sb-discovery-empty"><EmptyState title={query ? "No matching markets" : filter !== "all" ? "Nothing here yet" : "Be the first to launch"}>{query ? "Try another name, ticker, or market address." : filter !== "all" ? "Connect your wallet on Monad Testnet to explore your balances and rewards." : `Create a coin and start the first ${data.stockToken.symbol} market.`}</EmptyState><Button variant="secondary" onClick={() => { setQuery(""); setFilter("all"); setPairAsset("all"); if (availableMarkets.length === 0) navigate("launch"); }}>{availableMarkets.length === 0 ? "Launch a coin" : "Show all markets"}<ArrowRight size={14} aria-hidden="true" /></Button></div> : <div className="sb-token-grid">{markets.map((market) => {
        const quoteAsset = market.stockToken ?? data.stockToken;
        const openMarket = () => { run(() => (actions.selectDiscoveryMarket ?? actions.selectMarket)(market.id)); navigate("trading"); };
        const hasAddress = /^0x[0-9a-fA-F]{40}$/.test(market.token.id);
        return <article className="sb-token-card" key={market.id}>
          <button type="button" className="sb-token-card-open" disabled={busy} aria-label={`Trade ${market.token.symbol}`} onClick={openMarket} />
          <div className="sb-token-card-top">
            <span className="sb-token-card-avatar">{market.token.image ? <img src={market.token.image} alt="" width={52} height={52} /> : <TokenMark symbol={market.token.symbol} />}</span>
            <div className="sb-token-card-actions">
              <button type="button" disabled={busy} onClick={openMarket} aria-label={`View rewards for ${market.token.symbol}`} title="View holder rewards"><Gift size={16} aria-hidden="true" /></button>
              <button type="button" disabled={!hasAddress} onClick={() => void copyTokenAddress(market.token.id)} aria-label={`Copy ${market.token.symbol} contract address`} title={hasAddress ? market.token.id : "Token address unavailable"}>CA{copiedToken === market.token.id ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}</button>
            </div>
          </div>
          <div className="sb-token-card-identity"><strong>${market.token.symbol}</strong><span>{market.token.name}</span></div>
          <div className="sb-token-card-reserve"><span>Quote reserve</span><strong><Amount value={market.stockReserve} digits={2} /></strong></div>
          <div className="sb-token-card-pair">Paired with <QuoteAssetLogo token={quoteAsset} small /><strong>{quoteAsset.symbol}</strong><span className="sb-token-card-chain">Monad</span></div>
          <div className="sb-token-card-watermark" aria-hidden="true"><QuoteAssetLogo token={quoteAsset} /></div>
          <div className="sb-token-card-bottom"><span>Price <strong><Amount value={market.estimatedPrice} digits={6} /></strong> {quoteAsset.symbol}</span><span>{(market.tradingFeeBps ?? 100) / 100}% fee <ArrowRight size={15} aria-hidden="true" /></span></div>
        </article>;
      })}</div>}
    </section>

    <section className="sb-discover-rewards" aria-label="Trading fee distribution"><div className="sb-rewards-intro"><h2>Trading fee distribution</h2><p>Every trade pays its market’s 1% or 3% fee in {data.stockToken.symbol}.<br />Here is where it goes.</p></div><div className="sb-share"><span>Token holders</span><strong>40<small>%</small></strong><p>For the people holding the meme.</p><div style={{ "--share": "40%" } as CSSProperties} /></div><div className="sb-share"><span>StockVault</span><strong>10<small>%</small></strong><p>For the people locking {data.stockToken.symbol}.</p><div style={{ "--share": "10%" } as CSSProperties} /></div><div className="sb-share"><span>Protocol treasury</span><strong>50<small>%</small></strong><p>For the protocol behind the markets.</p><div style={{ "--share": "50%" } as CSSProperties} /></div></section>
  </div>;
}
