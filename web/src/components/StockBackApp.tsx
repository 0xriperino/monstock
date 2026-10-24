"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRightLeft, CheckCircle2, CircleAlert, Layers3, LayoutGrid, LoaderCircle, Plus, Rocket, Wallet } from "lucide-react";
import type { MaybePromise, StockBackAppProps, StockBackView } from "../types/ui";
import { Button, shortAddress } from "./ui";
import { PortfolioView } from "./overview-views";
import { DiscoverView } from "./DiscoverView";
import { TradingView } from "./TradingView";
import { AutoVaultView } from "./AutoVaultView";
import "../styles/stockback.css";

export interface ViewContext extends StockBackAppProps {
  ready: boolean;
  busy: boolean;
  now: number;
  navigate: (view: StockBackView) => void;
  run: (action: () => MaybePromise) => void;
  launchOpen: boolean;
  setLaunchOpen: (open: boolean) => void;
}

const tabs = [
  { id: "launchpad", label: "Discover", icon: Rocket },
  { id: "trading", label: "Trade", icon: ArrowRightLeft },
  { id: "autovault", label: "AutoVault", icon: Layers3 },
  { id: "portfolio", label: "Portfolio", icon: LayoutGrid },
] as const;

const descriptions: Record<StockBackView, { title: string; description: string }> = {
  launchpad: { title: "Launchpad", description: "Launch a meme. Build a market. Share the fees." },
  trading: { title: "Trading terminal", description: "Trade memes against your selected quote asset on Monad Testnet." },
  autovault: { title: "AutoVault", description: "Put your selected quote asset to work in StockVault." },
  portfolio: { title: "Your portfolio", description: "Your tokens, holder rewards, and locked positions." },
};

export function StockBackApp({ data, actions }: StockBackAppProps) {
  const [view, setView] = useState<StockBackView>(data.initialView ?? "launchpad");
  const [now, setNow] = useState(0);
  const [invoking, setInvoking] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [launchOpen, setLaunchOpen] = useState(false);
  const actionLock = useRef(false);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, []);

  const chainBusy = data.transaction.status === "pending"
    || data.wallet.status === "connecting"
    || data.vault.approval.status === "approving"
    || data.vault.positions.some((position) => position.isWithdrawing)
    || data.markets.some((market) => market.stockApproval.status === "approving"
      || market.memeApproval.status === "approving" || market.epoch.isSettling);
  const busy = chainBusy || invoking;
  const ready = data.wallet.status === "connected" && Boolean(data.wallet.address)
    && data.wallet.networkStatus === "correct";

  function run(action: () => MaybePromise) {
    if (actionLock.current || chainBusy) return;
    actionLock.current = true;
    setInvoking(true);
    setActionError(null);
    // A resolved callback is not a receipt. Success is rendered only from props.
    void Promise.resolve().then(action).catch((error: unknown) => {
      setActionError(error instanceof Error ? error.message : "The action could not complete. Please try again.");
    }).finally(() => { actionLock.current = false; setInvoking(false); });
  }

  const context: ViewContext = { data, actions, ready, busy, now, run, navigate: setView, launchOpen, setLaunchOpen };
  const walletLabel = data.wallet.status === "connecting" ? "Connecting…"
    : data.wallet.status === "connected" ? shortAddress(data.wallet.address) : "Connect wallet";
  const tx = data.transaction;
  const explorerUrl = tx.explorerUrl && /^https?:\/\//i.test(tx.explorerUrl) ? tx.explorerUrl : undefined;

  return <div className="sb-app">
    <a className="sb-skip" href="#stockback-content">Skip to content</a>
    <header className="sb-topbar">
      <a className="sb-brand" href="#stockback-content" onClick={() => setView("launchpad")} aria-label="StockBack launchpad">
        <span className="sb-brand-symbol"><Layers3 size={25} strokeWidth={2.3} aria-hidden="true" /></span>
        <span>Stock<span className="sb-brand-light">Back</span></span>
      </a>
      <nav className="sb-nav" aria-label="Main navigation">{tabs.map(({ id, label, icon: Icon }) =>
        <button type="button" key={id} onClick={() => setView(id)} aria-current={view === id ? "page" : undefined}
          className={`sb-nav-item ${view === id ? "is-active" : ""}`}><Icon size={16} aria-hidden="true" />{label}</button>
      )}</nav>
      <div className="sb-topbar-actions">
        <span className="sb-network"><span className={`sb-dot ${data.wallet.networkStatus === "wrong" ? "sb-dot--warning" : ""}`} />{data.wallet.networkName}</span>
        <Button className="sb-header-launch" onClick={() => { setView("launchpad"); setLaunchOpen(true); }} disabled={busy}><Plus size={16} aria-hidden="true" />Launch coin</Button>
        <Button variant="secondary" disabled={busy || data.wallet.status === "connected"}
          onClick={() => run(actions.connectWallet)}><Wallet size={15} aria-hidden="true" />{walletLabel}</Button>
      </div>
    </header>

    <main id="stockback-content" className="sb-main" tabIndex={-1}>
      {data.quoteAssets && data.quoteAssets.length > 1 && <div className="sb-quote-bar">
        <label htmlFor="quote-asset">Pair asset</label>
        <select id="quote-asset" aria-label="Pair asset" value={data.stockToken.id} disabled={busy} onChange={event => { const nextId = event.currentTarget.value; run(() => actions.selectQuoteAsset?.(nextId)); }}>
          {data.quoteAssets.map(asset => <option key={asset.id} value={asset.id}>{asset.symbol}</option>)}
        </select><span>Testnet demo assets · Balances and rewards shown in {data.stockToken.symbol}</span>
      </div>}
      {data.preview && <div className="sb-preview" role="note">Component preview · Synthetic data · No transactions are submitted</div>}

      {view !== "launchpad" && <div className="sb-page-heading"><div><h1>{descriptions[view].title}</h1><p>{descriptions[view].description}</p></div>
        <span className="sb-badge"><span className="sb-dot sb-dot--purple" />{data.stockToken.symbol} markets</span>
      </div>}

      {data.wallet.status !== "connected" ? <div className="sb-notice"><Wallet size={18} aria-hidden="true" /><div><strong>Connect to get started</strong><p>Explore the markets. Connect your wallet to trade, launch, or lock tokens.</p></div>
        <Button variant="secondary" disabled={busy} onClick={() => run(actions.connectWallet)}>{data.wallet.status === "connecting" ? "Connecting…" : "Connect wallet"}</Button></div>
        : data.wallet.networkStatus !== "correct" ? <div className="sb-notice sb-notice--warning" role="alert"><CircleAlert size={18} aria-hidden="true" /><div><strong>{data.wallet.networkStatus === "wrong" ? "Switch to Monad Testnet" : "Waiting for network confirmation"}</strong><p>Confirm the test network before submitting an action.</p></div><Button disabled={busy} onClick={() => run(actions.switchNetwork)}>Switch network</Button></div> : null}

      {ready && data.wallet.balancesStatus === "loading" && <div className="sb-inline-status" role="status"><LoaderCircle size={15} className="sb-spin" aria-hidden="true" />Loading wallet balances…</div>}
      {ready && data.wallet.balancesStatus === "error" && <div className="sb-notice sb-notice--error" role="alert"><CircleAlert size={18} aria-hidden="true" /><div><strong>Balances unavailable</strong><p>{data.wallet.balancesError ?? "Wallet balances could not be loaded. Spending is disabled until data is available."}</p></div></div>}
      {(tx.status !== "idle" || invoking) && <div className={`sb-transaction sb-transaction--${tx.status}`} role={tx.status === "error" ? "alert" : "status"}>
        {tx.status === "success" ? <CheckCircle2 size={18} aria-hidden="true" /> : tx.status === "error" ? <CircleAlert size={18} aria-hidden="true" /> : <LoaderCircle className="sb-spin" size={18} aria-hidden="true" />}
        <div><strong>{tx.status === "success" ? "Transaction confirmed" : tx.status === "error" ? "Transaction failed" : tx.label ?? "Waiting for wallet or network"}</strong>
          {tx.message && <p>{tx.message}</p>}{tx.hash && <p className="sb-hash">{tx.hash}</p>}</div>
        {explorerUrl && <a href={explorerUrl} target="_blank" rel="noreferrer">View transaction</a>}
      </div>}
      {actionError && <div className="sb-notice sb-notice--error" role="alert"><CircleAlert size={18} aria-hidden="true" /><p>{actionError}</p></div>}

      {view === "launchpad" && <DiscoverView {...context} />}
      {view === "trading" && <TradingView key={`${data.stockToken.id}:${data.selectedMarketId}`} {...context} />}
      {view === "autovault" && <AutoVaultView key={`${data.stockToken.id}:${data.selectedMarketId}`} {...context} />}
      {view === "portfolio" && <PortfolioView {...context} />}

    </main>
  </div>;
}

export default StockBackApp;
