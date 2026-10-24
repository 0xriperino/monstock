"use client";

import { useId, useState } from "react";
import { ArrowRight, Check, Clock3, LockKeyhole, ShieldCheck, UnlockKeyhole } from "lucide-react";
import type { LockDays } from "../types/ui";
import type { ViewContext } from "./StockBackApp";
import { Amount, Button, EmptyState, InfoRow, LoadingState, Panel, Stat, canSpend, dateLabel, isApproved, positive } from "./ui";

export const LOCK_WEIGHTS: Record<LockDays, string> = { 30: "1.00x", 90: "1.25x", 180: "1.60x" };

export function AutoVaultView({ data, actions, ready, busy, now, run }: ViewContext) {
  const id = useId();
  const [amount, setAmount] = useState("");
  const [lockDays, setLockDays] = useState<LockDays>(30);
  const [confirmed, setConfirmed] = useState(false);
  const balanceReady = ready && data.wallet.balancesStatus === "ready";
  const approval = data.vault.approval;
  const amountValid = positive(amount, data.stockToken.decimals);
  const sufficient = balanceReady && canSpend(amount, data.wallet.stockBalance, data.stockToken.decimals);
  const approved = isApproved(approval, amount, data.stockToken.decimals);
  const projectedUnlock = now > 0 ? dateLabel(now + lockDays * 86400000) : "—";
  const canDeposit = ready && sufficient && approved && confirmed && !busy;
  const positionsReady = ready && data.vault.positionsStatus === "ready";

  return <div className="sb-stack">
    <section className="sb-stats sb-stats--three" aria-label="StockVault balances">
      <Stat label="Available to lock" unit="MockSPYx"><Amount value={balanceReady ? data.wallet.stockBalance : null} /></Stat>
      <Stat label="Your locked principal" unit="MockSPYx"><Amount value={positionsReady ? data.vault.totalLockedPrincipal : null} /></Stat>
      <Stat label="Earned fee rewards" unit="MockSPYx"><Amount value={positionsReady ? data.vault.earnedRewards : null} /></Stat>
    </section>
    <div className="sb-vault-grid">
      <Panel title="Lock MockSPYx" aside={<LockKeyhole size={18} className="sb-accent" aria-hidden="true" />}>
        <p className="sb-panel-description">Use claimed holder rewards or any MockSPYx already in your wallet.</p>
        <form className="sb-form" onSubmit={(event) => { event.preventDefault(); if (canDeposit) run(() => actions.depositToVault({ amount, lockDays })); }}>
          <div className="sb-field"><label htmlFor={`${id}-deposit`}>Deposit amount</label><div className="sb-input-with-unit"><input id={`${id}-deposit`} inputMode="decimal" value={amount} placeholder="0.00" required autoComplete="off" disabled={busy} aria-describedby={`${id}-deposit-help`} aria-invalid={Boolean(amount && (!amountValid || (balanceReady && !sufficient)))} onChange={(event) => { setAmount(event.target.value); setConfirmed(false); }} /><span>MockSPYx</span></div><small id={`${id}-deposit-help`}>{amount && !amountValid ? `Enter a positive amount with up to ${data.stockToken.decimals} decimals.` : amountValid && balanceReady && !sufficient ? "Insufficient MockSPYx balance." : <>Available: <Amount value={balanceReady ? data.wallet.stockBalance : null} /> MockSPYx</>}</small></div>
          <fieldset className="sb-lock-fieldset" disabled={busy}><legend>Lock period</legend><div className="sb-lock-options">{([30, 90, 180] as const).map((days) => <label key={days} className={days === lockDays ? "is-active" : ""}><input type="radio" name={`${id}-lock`} value={days} checked={days === lockDays} onChange={() => { setLockDays(days); setConfirmed(false); }} /><span>{days} days</span><strong>{LOCK_WEIGHTS[days]}</strong>{days === lockDays && <Check size={13} aria-hidden="true" />}</label>)}</div></fieldset>
          <dl className="sb-details"><InfoRow label="Reward weight"><span className="sb-accent">{LOCK_WEIGHTS[lockDays]}</span></InfoRow><InfoRow label="Estimated unlock">{projectedUnlock} UTC</InfoRow></dl>
          <p className="sb-input-help">Weights determine your share of fee rewards. They are allocation multipliers, not guaranteed APY.</p>
          <label className="sb-confirm" htmlFor={`${id}-confirm`}><input id={`${id}-confirm`} type="checkbox" checked={confirmed} disabled={busy} onChange={(event) => setConfirmed(event.target.checked)} /><span>I understand that this deposit is locked for {lockDays} days. Early withdrawal is not possible.</span></label>
          <div className="sb-approval" role="status"><ShieldCheck size={15} aria-hidden="true" /><span>{approval.status === "approving" ? "Approving StockVault spending…" : approval.status === "unknown" ? "Vault allowance has not been loaded." : approved ? "StockVault spending approved" : approval.status === "error" ? approval.error ?? "Approval failed. Please retry." : "Approve MockSPYx for StockVault before depositing."}</span></div>
          {!approved && <Button type="button" variant="secondary" className="sb-full" busy={approval.status === "approving"} disabled={!ready || !sufficient || busy || approval.status === "unknown"} onClick={() => run(() => actions.approveVault(amount))}>Approve MockSPYx</Button>}
          <Button type="submit" className="sb-full" disabled={!canDeposit}><LockKeyhole size={15} aria-hidden="true" />Lock for {lockDays} days<ArrowRight size={15} aria-hidden="true" /></Button>
        </form>
      </Panel>

      <div className="sb-stack">
        <section className="sb-vault-disclosure" aria-label="StockVault reward information"><h2>A share of fees.<br />A commitment of time.</h2><p>StockVault receives 10% of trading fees. Longer locks carry more weight when those rewards are allocated.</p><div><Clock3 size={17} aria-hidden="true" /><strong>Every lock runs its full term.</strong></div><p>Rewards depend on trading fee revenue and are not guaranteed.</p></section>
        <Panel title="Active positions" aside={<span className="sb-count">{positionsReady ? `${data.vault.positions.length} positions` : "—"}</span>}>
          {!ready ? <EmptyState title="Connect to view positions">Your wallet’s locked MockSPYx positions will appear here.</EmptyState>
            : data.vault.positionsStatus === "loading" ? <LoadingState label="Loading vault positions" />
            : data.vault.positionsStatus === "error" ? <EmptyState error title="Positions unavailable">{data.vault.positionsError ?? "Vault positions could not be loaded."}</EmptyState>
            : data.vault.positions.length === 0 ? <EmptyState title="Your first lock starts here">Deposit MockSPYx and choose a lock period to create a position.</EmptyState>
            : <ul className="sb-vault-positions">{data.vault.positions.map((position, index) => {
              const elapsed = now > 0 && now >= position.unlocksAt;
              const unlocked = elapsed && position.canWithdraw;
              const Icon = elapsed ? UnlockKeyhole : LockKeyhole;
              return <li key={position.id}><div className="sb-position-heading"><div><strong>Position {index + 1}</strong><span className="sb-muted">{position.lockDays} days <span aria-hidden="true">·</span> {LOCK_WEIGHTS[position.lockDays]} weight</span></div><span className={`sb-badge ${unlocked ? "sb-badge--positive" : ""}`}><Icon size={12} aria-hidden="true" />{unlocked ? "Unlocked" : elapsed ? "Awaiting eligibility" : "Locked"}</span></div>
                <dl className="sb-details"><InfoRow label="Principal"><Amount value={position.principal} /> MockSPYx</InfoRow><InfoRow label="Unlocks on">{dateLabel(position.unlocksAt)} UTC</InfoRow><InfoRow label="Earned fee rewards"><Amount value={position.earnedRewards} /> MockSPYx</InfoRow></dl>
                <Button variant="secondary" className="sb-full" disabled={!ready || busy || !unlocked} busy={position.isWithdrawing} onClick={() => run(() => actions.withdrawFromVault(position.id))}>{unlocked ? "Withdraw position" : elapsed ? "Waiting for eligibility confirmation" : `Locked until ${dateLabel(position.unlocksAt)}`}</Button>
              </li>;
            })}</ul>}
        </Panel>
      </div>
    </div>
  </div>;
}
