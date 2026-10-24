"use client";

import { useId, useState } from "react";
import { ArrowDownToLine, ArrowRight, LockKeyhole, Plus, Rocket, Wallet } from "lucide-react";
import type { ViewContext } from "./StockBackApp";
import { Amount, Button, EmptyState, InfoRow, LoadingState, Panel, Stat, TokenMark, atomic, canSpend, dateLabel, positive, shortAddress } from "./ui";

export function LaunchpadView({ data, actions, ready, busy, run, navigate }: ViewContext) {
  const id = useId();
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [liquidity, setLiquidity] = useState("");
  const balanceReady = ready && data.wallet.balancesStatus === "ready";
  const sufficient = balanceReady && canSpend(liquidity, data.wallet.stockBalance, data.stockToken.decimals);
  const valid = name.trim().length > 0 && /^[A-Z0-9]{1,12}$/.test(symbol) && sufficient;
  const amountValid = positive(liquidity, data.stockToken.decimals);

  return <div className="sb-launch-grid">
    <Panel title="Create a token" aside={<Rocket size={18} className="sb-accent" aria-hidden="true" />}>
      <p className="sb-panel-description">Your token. Your community. A market backed by {data.stockToken.symbol} liquidity.</p>
      <form className="sb-form" onSubmit={(event) => { event.preventDefault(); if (valid && ready && !busy) run(() => actions.createCoin({ name: name.trim(), symbol, initialStockLiquidity: liquidity })); }}>
        <div className="sb-field"><label htmlFor={`${id}-name`}>Token name</label><input id={`${id}-name`} value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Market Cat" maxLength={48} autoComplete="off" required disabled={busy} /></div>
        <div className="sb-field"><label htmlFor={`${id}-symbol`}>Token symbol</label><div className="sb-input-with-prefix"><span>$</span><input id={`${id}-symbol`} value={symbol} onChange={(event) => setSymbol(event.target.value.toUpperCase())} placeholder="MCAT" pattern="[A-Z0-9]{1,12}" maxLength={12} autoComplete="off" required disabled={busy} /></div><small>1–12 letters or numbers.</small></div>
        <div className="sb-field"><label htmlFor={`${id}-liquidity`}>Initial liquidity</label><div className="sb-input-with-unit"><input id={`${id}-liquidity`} inputMode="decimal" value={liquidity} onChange={(event) => setLiquidity(event.target.value)} placeholder="0.00" required aria-describedby={`${id}-liquidity-help`} aria-invalid={Boolean(liquidity && (!amountValid || (balanceReady && !sufficient)))} disabled={busy} /><span>{data.stockToken.symbol}</span></div>
          <small id={`${id}-liquidity-help`}>{liquidity && !amountValid ? `Enter a positive amount with up to ${data.stockToken.decimals} decimals.` : balanceReady && amountValid && !sufficient ? `Insufficient ${data.stockToken.symbol} balance.` : <>Available: <Amount value={balanceReady ? data.wallet.stockBalance : null} /> {data.stockToken.symbol}</>}</small>
        </div>
        <div className="sb-form-note"><LockKeyhole size={15} aria-hidden="true" /><span>New markets trade exclusively against {data.stockToken.symbol}.</span></div>
        <Button type="submit" className="sb-full" disabled={!ready || !valid || busy}><Plus size={17} aria-hidden="true" />Create token</Button>
        <small className="sb-centered sb-muted">{busy ? "Complete the current wallet action first." : "Creation requires wallet confirmation."}</small>
      </form>
    </Panel>

    <div className="sb-market-column">
      <Panel title="Markets" aside={<span className="sb-count">{data.marketsStatus === "ready" ? `${data.markets.length} markets` : `${data.stockToken.symbol} pairs`}</span>}>
        {data.marketsStatus === "loading" ? <LoadingState label="Loading markets" />
          : data.marketsStatus === "error" ? <EmptyState title="Markets unavailable" error>{data.marketsError ?? "Market data could not be loaded. Please try again later."}</EmptyState>
          : data.markets.length === 0 ? <EmptyState title="A fresh market starts here">No tokens have been launched yet. Create the first {data.stockToken.symbol} market using the form.</EmptyState>
          : <div className="sb-table-scroll"><table className="sb-table"><caption className="sb-sr-only">Created meme token markets</caption><thead><tr><th scope="col">Token / pair</th><th scope="col">Est. price</th><th scope="col">Stock reserve</th><th scope="col"><span className="sb-sr-only">Action</span></th></tr></thead>
            <tbody>{data.markets.map((market) => <tr key={market.id}><th scope="row"><div className="sb-token-cell"><TokenMark symbol={market.token.symbol} /><div><strong>{market.token.name}</strong><small>{market.token.symbol} / {data.stockToken.symbol}</small></div></div></th><td><Amount value={market.estimatedPrice} digits={8} /><small>{data.stockToken.symbol}</small></td><td><Amount value={market.stockReserve} /><small>{data.stockToken.symbol}</small></td><td><Button variant="ghost" disabled={busy} aria-label={`Trade ${market.token.symbol}`} onClick={() => { run(() => actions.selectMarket(market.id)); navigate("trading"); }}>Trade<ArrowRight size={15} aria-hidden="true" /></Button></td></tr>)}</tbody>
          </table></div>}
      </Panel>
      <section className="sb-fee-explainer" aria-label="Trading fee allocation"><div><h2>Every trade gives back.</h2><p>A 1% or 3% trading fee is shared across the ecosystem.</p></div><div className="sb-fee-bar" aria-hidden="true"><span /><span /><span /></div><div className="sb-fee-legend"><span><i /> <strong>40%</strong> Token holders</span><span><i /> <strong>10%</strong> StockVault</span><span><i /> <strong>50%</strong> Treasury</span></div><small>Percentages are shares of the trading fee, not of the full trade amount.</small></section>
    </div>
  </div>;
}

export function PortfolioView({ data, actions, ready, busy, run, navigate }: ViewContext) {
  const balanceReady = ready && data.wallet.balancesStatus === "ready";
  const positionsReady = ready && data.vault.positionsStatus === "ready";
  const holdings = data.markets.filter((market) => (atomic(market.walletBalance ?? "0", market.token.decimals) ?? BigInt(0)) > BigInt(0));
  if (!ready) return <Panel title="Wallet overview"><EmptyState title="Your portfolio lives here">Connect your wallet to Monad Testnet to view token holdings, rewards, and StockVault positions.</EmptyState></Panel>;

  return <div className="sb-stack">
    <div className="sb-wallet-heading"><div><Wallet size={18} aria-hidden="true" /><strong title={data.wallet.address ?? undefined}>{shortAddress(data.wallet.address)}</strong><span className="sb-badge sb-badge--positive">Connected</span></div>
      <Button variant="secondary" disabled={!data.wallet.faucetAvailable || busy} onClick={() => run(actions.requestFaucet)}><ArrowDownToLine size={15} aria-hidden="true" />Get test tokens</Button></div>
    <section className="sb-stats sb-stats--four" aria-label="Portfolio balances">
      <Stat label="Wallet balance" unit={`${data.stockToken.symbol}`}><Amount value={balanceReady ? data.wallet.stockBalance : null} /></Stat>
      <Stat label="Claimable holder rewards" unit={`${data.stockToken.symbol}`}><Amount value={balanceReady ? data.portfolio.claimableHolderRewards : null} /></Stat>
      <Stat label="Locked principal" unit={`${data.stockToken.symbol}`}><Amount value={positionsReady ? data.vault.totalLockedPrincipal : null} /></Stat>
      <Stat label="Earned vault rewards" unit={`${data.stockToken.symbol}`}><Amount value={positionsReady ? data.vault.earnedRewards : null} /></Stat>
    </section>
    <div className="sb-two-columns">
      <Panel title="Your meme tokens" aside={<span className="sb-count">{balanceReady && data.marketsStatus === "ready" ? `${holdings.length} assets` : "—"}</span>}>
        {!balanceReady || data.marketsStatus !== "ready" ? data.wallet.balancesStatus === "error" || data.marketsStatus === "error" ? <EmptyState error title="Holdings unavailable">Balances and markets must load before holdings can be displayed.</EmptyState> : <LoadingState label="Loading holdings" />
          : holdings.length === 0 ? <EmptyState title="No meme tokens yet">Trade a {data.stockToken.symbol} pair to start building your portfolio.<Button variant="secondary" onClick={() => navigate("launchpad")}>Explore markets<ArrowRight size={15} aria-hidden="true" /></Button></EmptyState>
          : <ul className="sb-holdings">{holdings.map((market) => <li key={market.id}><div className="sb-token-cell"><TokenMark symbol={market.token.symbol} /><div><strong>{market.token.name}</strong><small><Amount value={market.walletBalance} /> {market.token.symbol}</small></div></div><div className="sb-holding-reward"><small>Claimable {data.stockToken.symbol}</small><Amount value={market.claimableRewards} /><Button variant="ghost" disabled={busy} onClick={() => { run(() => actions.selectMarket(market.id)); navigate("trading"); }}>Trade & claim<ArrowRight size={14} aria-hidden="true" /></Button></div></li>)}</ul>}
      </Panel>
      <Panel title="Vault positions" aside={<Button variant="ghost" onClick={() => navigate("autovault")}>Manage<ArrowRight size={14} aria-hidden="true" /></Button>}>
        {data.vault.positionsStatus === "loading" ? <LoadingState label="Loading positions" />
          : data.vault.positionsStatus === "error" ? <EmptyState error title="Positions unavailable">{data.vault.positionsError ?? "Vault positions could not be loaded."}</EmptyState>
          : data.vault.positions.length === 0 ? <EmptyState title="No locked positions">Lock wallet tokens or claimed holder rewards in StockVault to participate in fee allocation.</EmptyState>
          : <ul className="sb-position-summaries">{data.vault.positions.map((position, index) => <li key={position.id}><div><strong>Position {index + 1}</strong><span className="sb-muted">{position.lockDays} day lock</span></div><dl><InfoRow label="Principal"><Amount value={position.principal} /> {data.stockToken.symbol}</InfoRow><InfoRow label="Unlock date">{dateLabel(position.unlocksAt)} UTC</InfoRow><InfoRow label="Earned rewards"><Amount value={position.earnedRewards} /> {data.stockToken.symbol}</InfoRow></dl></li>)}</ul>}
      </Panel>
    </div>
  </div>;
}
