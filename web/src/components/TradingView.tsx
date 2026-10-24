"use client";

import { useId, useRef, useState } from "react";
import { ArrowDown, ArrowRight, Clock3, Gift, RefreshCw, ShieldCheck } from "lucide-react";
import type { TradeRequest, TradeSide } from "../types/ui";
import type { ViewContext } from "./StockBackApp";
import { Amount, Button, EmptyState, InfoRow, LoadingState, Panel, Stat, TokenMark, atomic, canSpend, isApproved, positive } from "./ui";

export function TradingView({ data, actions, ready, busy, now, run, navigate }: ViewContext) {
  const id = useId();
  const [side, setSide] = useState<TradeSide>("buy");
  const [amount, setAmount] = useState("");
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const quoteSequence = useRef(0);
  const market = data.markets.find((item) => item.id === data.selectedMarketId);
  const balanceReady = ready && data.wallet.balancesStatus === "ready";

  function requestQuote(nextAmount: string, nextSide = side) {
    const sequence = ++quoteSequence.current;
    setQuoteError(null);
    const decimals = nextSide === "buy" ? data.stockToken.decimals : market?.token.decimals ?? 18;
    if (!market || !positive(nextAmount, decimals) || !actions.requestTradeQuote) return;
    const params: TradeRequest = { marketId: market.id, side: nextSide, amount: nextAmount, slippageBps: data.slippageBps };
    void Promise.resolve().then(() => actions.requestTradeQuote?.(params)).catch((error: unknown) => {
      if (quoteSequence.current === sequence) setQuoteError(error instanceof Error ? error.message : "Quote unavailable. Try refreshing the estimate.");
    });
  }

  if (data.marketsStatus === "loading") return <Panel title="Trading terminal"><LoadingState label="Loading markets" /></Panel>;
  if (data.marketsStatus === "error") return <Panel title="Trading terminal"><EmptyState title="Markets unavailable" error>{data.marketsError ?? "Market data could not be loaded."}</EmptyState></Panel>;
  if (!market) return <Panel title="Select a market"><EmptyState title={data.markets.length ? "Choose your pair" : "No markets yet"}>Select a meme token from the launchpad to open its trading terminal.<Button variant="secondary" onClick={() => navigate("launchpad")}>Explore markets<ArrowRight size={15} aria-hidden="true" /></Button></EmptyState></Panel>;

  const inputToken = side === "buy" ? data.stockToken : market.token;
  const outputToken = side === "buy" ? market.token : data.stockToken;
  const inputBalance = side === "buy" ? data.wallet.stockBalance : market.walletBalance;
  const approval = side === "buy" ? market.stockApproval : market.memeApproval;
  const amountValid = positive(amount, inputToken.decimals);
  const sufficient = balanceReady && canSpend(amount, inputBalance, inputToken.decimals);
  const approved = isApproved(approval, amount, inputToken.decimals);
  const approvalKnown = approval.status !== "unknown";
  const quote = data.tradeQuote;
  const sameQuote = quote?.marketId === market.id && quote.side === side
    && quote.slippageBps === data.slippageBps
    && atomic(quote.amount, inputToken.decimals) !== null
    && atomic(quote.amount, inputToken.decimals) === atomic(amount, inputToken.decimals);
  const slippageValid = Number.isInteger(data.slippageBps) && data.slippageBps >= 0 && data.slippageBps < 10000;
  const quoteReady = Boolean(sameQuote && quote?.status === "ready" && now > 0 && quote.expiresAt > now
    && quote.outputAmount !== null && positive(quote.outputAmount, outputToken.decimals)
    && quote.minimumOutput !== null && positive(quote.minimumOutput, outputToken.decimals)
    && quote.feeAmount !== null && atomic(quote.feeAmount, inputToken.decimals) !== null && slippageValid);
  const tradeEnabled = ready && sufficient && approved && quoteReady && Boolean(actions.requestTradeQuote) && !busy;
  const approvalEnabled = ready && sufficient && !approved && approvalKnown && !busy;
  const seconds = now > 0 ? Math.max(0, Math.ceil((market.epoch.endsAt - now) / 1000)) : null;
  const countdown = seconds === null ? "—:—" : seconds === 0 ? "Ready to settle" : `${Math.floor(seconds / 60).toString().padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;

  function submitTrade() {
    if (!tradeEnabled || !quote?.minimumOutput) return;
    const params = { marketId: market!.id, side, amount, slippageBps: data.slippageBps, quoteId: quote.id, minimumOutput: quote.minimumOutput };
    run(() => side === "buy" ? actions.buy(params) : actions.sell(params));
  }

  return <div className="sb-stack">
    <section className="sb-market-header" aria-label="Selected market">
      <div className="sb-token-cell"><TokenMark symbol={market.token.symbol} /><div><h2>{market.token.symbol}<span className="sb-muted"> / MockSPYx</span></h2><p>{market.token.name}</p></div></div>
      <div className="sb-field sb-market-selector"><label htmlFor={`${id}-market`} className="sb-sr-only">Selected market</label><select id={`${id}-market`} value={market.id} disabled={busy} onChange={(event) => { setAmount(""); setQuoteError(null); ++quoteSequence.current; run(() => actions.selectMarket(event.target.value)); }}>
        {data.markets.map((item) => <option value={item.id} key={item.id}>{item.token.symbol} / MockSPYx</option>)}
      </select></div>
    </section>
    <div className="sb-trading-grid">
      <div className="sb-stack">
        <section className="sb-stats sb-stats--three" aria-label="Pool information">
          <Stat label="Estimated token price" unit="MockSPYx"><Amount value={market.estimatedPrice} digits={8} /></Stat>
          <Stat label="Stock reserve" unit="MockSPYx"><Amount value={market.stockReserve} /></Stat>
          <Stat label="Meme reserve" unit={market.token.symbol}><Amount value={market.memeReserve} /></Stat>
        </section>
        <Panel title="Holder rewards" aside={<Gift size={18} className="sb-accent" aria-hidden="true" />}>
          <div className="sb-reward-main"><div><span className="sb-muted">Claimable balance</span><strong><Amount value={balanceReady ? market.claimableRewards : null} /><small>MockSPYx</small></strong></div>
            <Button disabled={!balanceReady || !positive(market.claimableRewards ?? "0", data.stockToken.decimals) || busy} onClick={() => run(() => actions.claimHolderRewards(market.id))}>Claim rewards</Button>
          </div><p className="sb-panel-description">Token holders share 40% of each trading fee. Claimed MockSPYx goes to your wallet and can be locked in StockVault.</p>
          <div className="sb-epoch"><div><Clock3 size={17} aria-hidden="true" /><div><strong>5-minute reward epoch</strong><span className="sb-muted">{seconds === 0 ? "Epoch ended. Settlement may be available." : "Time until the current epoch ends"}</span></div></div><strong className="sb-countdown" role="timer" aria-label="Time until epoch settlement" aria-live="off">{countdown}</strong></div>
          <div className="sb-panel-bottom"><span className="sb-muted">Settlement updates holder reward allocation.</span><Button variant="secondary" disabled={!ready || busy || seconds !== 0 || !market.epoch.canSettle} busy={market.epoch.isSettling} onClick={() => run(() => actions.settleEpoch(market.id))}>Settle epoch</Button></div>
        </Panel>
        <Panel title="Your balances"><dl className="sb-details"><InfoRow label="MockSPYx"><Amount value={balanceReady ? data.wallet.stockBalance : null} /></InfoRow><InfoRow label={market.token.symbol}><Amount value={balanceReady ? market.walletBalance : null} /></InfoRow></dl><div className="sb-panel-bottom"><span className="sb-muted">Test tokens for testnet markets.</span><Button variant="ghost" disabled={!ready || !data.wallet.faucetAvailable || busy} onClick={() => run(actions.requestFaucet)}>Get test tokens<ArrowRight size={14} aria-hidden="true" /></Button></div></Panel>
      </div>

      <Panel title="Swap tokens" className="sb-trade-panel" aside={<span className="sb-badge">1% fee</span>}>
        <div className="sb-segmented" role="group" aria-label="Trade direction">{(["buy", "sell"] as const).map((value) => <button type="button" key={value} aria-pressed={side === value} disabled={busy} className={side === value ? `is-active sb-${value}` : ""} onClick={() => { setSide(value); setAmount(""); requestQuote("", value); }}>{value === "buy" ? "Buy" : "Sell"} {market.token.symbol}</button>)}</div>
        <form className="sb-form" onSubmit={(event) => { event.preventDefault(); submitTrade(); }}>
          <div className="sb-swap-input"><div className="sb-input-label"><label htmlFor={`${id}-amount`}>You pay</label><span>Balance: <Amount value={balanceReady ? inputBalance : null} /></span></div><div className="sb-input-with-unit"><input id={`${id}-amount`} inputMode="decimal" value={amount} placeholder="0.00" autoComplete="off" disabled={busy} required aria-describedby={`${id}-trade-help`} aria-invalid={Boolean(amount && (!amountValid || (balanceReady && !sufficient)))} onChange={(event) => { setAmount(event.target.value); requestQuote(event.target.value); }} /><span>{inputToken.symbol}</span></div></div>
          <div className="sb-swap-divider" aria-hidden="true"><ArrowDown size={17} /></div>
          <div className="sb-swap-output"><span>Estimated receive</span><div><strong>{quoteReady ? <Amount value={quote!.outputAmount} digits={6} /> : "—"}</strong><span>{outputToken.symbol}</span></div></div>
          <p id={`${id}-trade-help`} className={`sb-input-help ${amount && (!amountValid || (balanceReady && !sufficient)) ? "sb-negative" : ""}`}>
            {amount && !amountValid ? `Enter a positive amount with up to ${inputToken.decimals} decimals.` : amountValid && balanceReady && !sufficient ? `Insufficient ${inputToken.symbol} balance.` : "Output is an estimate until the transaction is confirmed."}
          </p>
          <dl className="sb-details sb-trade-details"><InfoRow label="Trading fee (1%)">{quoteReady ? <><Amount value={quote!.feeAmount} digits={6} /> {inputToken.symbol}</> : "—"}</InfoRow><InfoRow label="Slippage protection">{slippageValid ? `${data.slippageBps / 100}%` : "Unavailable"}</InfoRow><InfoRow label="Minimum received">{quoteReady ? <><Amount value={quote!.minimumOutput} digits={6} /> {outputToken.symbol}</> : "—"}</InfoRow></dl>
          <div className="sb-protection"><ShieldCheck size={16} aria-hidden="true" /><p>Your trade reverts if output falls below the minimum received.</p></div>
          {amountValid && <div className="sb-quote-state" role="status"><span>{quoteError ?? (sameQuote && quote?.status === "error" ? quote.error ?? "Quote unavailable." : sameQuote && quote?.status === "loading" ? "Fetching estimate…" : quoteReady ? "Estimate ready" : actions.requestTradeQuote ? "Refresh the estimate to continue." : "Quoting is awaiting integration.")}</span><Button type="button" variant="ghost" aria-label="Refresh trade estimate" disabled={busy || !actions.requestTradeQuote} onClick={() => requestQuote(amount)}><RefreshCw size={14} aria-hidden="true" />Refresh</Button></div>}
          <div className="sb-approval" role="status"><ShieldCheck size={15} aria-hidden="true" /><span>{approval.status === "approving" ? `Approving ${inputToken.symbol}…` : approval.status === "unknown" ? "Allowance has not been loaded." : approved ? `${inputToken.symbol} spending approved` : approval.status === "error" ? approval.error ?? "Approval failed. Please retry." : `Approve ${inputToken.symbol} before trading.`}</span></div>
          {!approved && <Button type="button" className="sb-full" variant="secondary" busy={approval.status === "approving"} disabled={!approvalEnabled} onClick={() => run(() => side === "buy" ? actions.approveStock({ marketId: market.id, amount }) : actions.approveMeme({ marketId: market.id, amount }))}>Approve {inputToken.symbol}</Button>}
          <Button type="submit" className="sb-full" disabled={!tradeEnabled}>{!ready ? "Connect on Monad Testnet to trade" : `${side === "buy" ? "Buy" : "Sell"} ${market.token.symbol}`}</Button>
        </form>
      </Panel>
    </div>
  </div>;
}
