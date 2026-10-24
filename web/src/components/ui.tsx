"use client";

import { LoaderCircle, Inbox, AlertCircle } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import type { TokenAmount, TokenApproval } from "../types/ui";

export function Button({ children, variant = "primary", busy = false, className = "", disabled, ...props }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost"; busy?: boolean }) {
  return <button {...props} disabled={disabled || busy} aria-busy={busy || undefined}
    className={`sb-button sb-button--${variant} ${className}`}>
    {busy && <LoaderCircle size={16} className="sb-spin" aria-hidden="true" />}{children}
  </button>;
}

export function Panel({ title, aside, children, className = "" }:
  { title: string; aside?: ReactNode; children: ReactNode; className?: string }) {
  return <section className={`sb-panel ${className}`} aria-label={title}>
    <div className="sb-panel-heading"><h2>{title}</h2>{aside}</div>{children}
  </section>;
}

export function EmptyState({ title, children, error = false }:
  { title: string; children: ReactNode; error?: boolean }) {
  const Icon = error ? AlertCircle : Inbox;
  return <div className={`sb-empty ${error ? "sb-negative" : ""}`} role={error ? "alert" : "status"}>
    <Icon size={27} strokeWidth={1.5} aria-hidden="true" /><h3>{title}</h3><p>{children}</p>
  </div>;
}

export function LoadingState({ label = "Loading data" }: { label?: string }) {
  return <div className="sb-loading" role="status" aria-label={label}>
    <span className="sb-muted">{label}…</span>
    {[0, 1, 2].map((i) => <span className="sb-skeleton" key={i} />)}
  </div>;
}

export function Stat({ label, children, unit }: { label: string; children: ReactNode; unit?: string }) {
  return <div className="sb-stat"><span>{label}</span><strong>{children}</strong>{unit && <small>{unit}</small>}</div>;
}

export function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return <div className="sb-info-row"><dt>{label}</dt><dd>{children}</dd></div>;
}

export function TokenMark({ symbol, small = false }: { symbol: string; small?: boolean }) {
  return <span className={`sb-token-mark ${small ? "sb-token-mark--small" : ""}`} aria-hidden="true">{symbol.slice(0, 2)}</span>;
}

export function Amount({ value, digits = 4 }: { value: TokenAmount | null; digits?: number }) {
  return <span className="sb-number" title={value ?? "Unavailable"}>{formatAmount(value, digits)}</span>;
}

/** Formatting only; no financial calculation is done with floating point. */
export function formatAmount(value: TokenAmount | null, digits = 4): string {
  if (value === null || !/^\d+(\.\d+)?$/.test(value)) return "—";
  const [whole, fraction = ""] = value.split(".");
  const grouped = whole.replace(/^0+(?=\d)/, "").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const shown = fraction.slice(0, digits).replace(/0+$/, "");
  if (/^0+$/.test(whole) && !/[1-9]/.test(fraction)) return "0";
  if (/^0+$/.test(whole) && !/[1-9]/.test(fraction.slice(0, digits)) && /[1-9]/.test(fraction)) return `<${digits ? `0.${"0".repeat(digits - 1)}1` : "1"}`;
  return shown ? `${grouped}.${shown}` : grouped;
}

export function atomic(value: string, decimals: number): bigint | null {
  if (!/^\d+(\.\d+)?$/.test(value) || !Number.isInteger(decimals) || decimals < 0 || decimals > 255) return null;
  const [whole, fraction = ""] = value.split(".");
  if (fraction.length > decimals) return null;
  return BigInt(whole + fraction.padEnd(decimals, "0"));
}

export function positive(value: string, decimals: number): boolean {
  const parsed = atomic(value, decimals);
  return parsed !== null && parsed > BigInt(0);
}

export function canSpend(amount: string, balance: string | null, decimals: number): boolean {
  const input = atomic(amount, decimals);
  const available = balance === null ? null : atomic(balance, decimals);
  return input !== null && input > BigInt(0) && available !== null && input <= available;
}

export function isApproved(approval: TokenApproval, amount: string, decimals: number): boolean {
  return approval.status === "approved" && canSpend(amount, approval.allowance, decimals);
}

export function dateLabel(timestamp: number): string {
  if (!Number.isFinite(timestamp)) return "Unavailable";
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(timestamp);
}

export function shortAddress(address: string | null): string {
  if (!address) return "Wallet unavailable";
  return address.length > 14 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}
