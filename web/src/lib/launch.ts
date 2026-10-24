import { formatUnits, parseUnits } from "viem";

export const CURVE_VIRTUAL_QUOTE_RESERVE = 1000n * 10n ** 18n;
export const MEME_SUPPLY = 1_000_000n * 10n ** 18n;
export function optionalUnits(value: string): bigint {
  if (!/^\d+(\.\d{1,18})?$/.test(value)) throw new Error("Use a positive decimal amount with up to 18 decimals.");
  const amount = parseUnits(value, 18);
  if (amount >= 2n ** 256n) throw new Error("Amount is outside the supported range.");
  return amount;
}
export function launchOutput(liquidity: bigint, devBuy: bigint, feeBps = 100) {
  if (feeBps !== 100 && feeBps !== 300) throw new Error("Choose a 1% or 3% trading fee.");
  if (liquidity <= 0n || devBuy < 0n) return 0n;
  const net = devBuy - devBuy * BigInt(feeBps) / 10_000n;
  return MEME_SUPPLY * net / (liquidity + net);
}
export function devBuyForPercent(liquidity: string, percent: number, feeBps = 100): string {
  if (feeBps !== 100 && feeBps !== 300) throw new Error("Choose a 1% or 3% trading fee.");
  if (!Number.isInteger(percent) || percent < 0 || percent > 75) throw new Error("Dev buy must be between 0% and 75%.");
  const initial = optionalUnits(liquidity);
  // Floor the gross input to stay at or below the requested supply percentage.
  return formatUnits(initial * BigInt(percent) * 10_000n / (BigInt(100 - percent) * BigInt(10_000 - feeBps)), 18);
}
export function curveLaunchOutput(devBuy: bigint, feeBps = 100) {
  return launchOutput(CURVE_VIRTUAL_QUOTE_RESERVE, devBuy, feeBps);
}
export function curveDevBuyForPercent(percent: number, feeBps = 100) {
  return devBuyForPercent(formatUnits(CURVE_VIRTUAL_QUOTE_RESERVE, 18), percent, feeBps);
}
export function safeProjectUrl(value?: string) {
  if (!value?.trim()) return undefined;
  const url = new URL(value.trim());
  if (url.protocol !== "https:" || url.username || url.password || value.length > 256) throw new Error("Project links must be HTTPS URLs, up to 256 characters.");
  return url.href;
}
export function safeTokenImage(value?: string) {
  if (!value) return undefined;
  if (value.length > 12_500 || !/^data:image\/(webp|png|jpeg);base64,[A-Za-z0-9+/]+=*$/.test(value)) throw new Error("Choose a valid token image.");
  return value;
}
export function encodeMetadata(input: { image?: string; website?: string; twitter?: string; telegram?: string } = {}) {
  const metadata = { image: safeTokenImage(input.image), website: safeProjectUrl(input.website), twitter: safeProjectUrl(input.twitter), telegram: safeProjectUrl(input.telegram) };
  const json = JSON.stringify(metadata);
  if (new TextEncoder().encode(json).length > 16_384) throw new Error("Token metadata is too large.");
  return json;
}
export function decodeMetadata(json: string) {
  try {
    if (json.length > 16_384) return {};
    const data = JSON.parse(json);
    return { image: safeTokenImage(data.image), website: safeProjectUrl(data.website), twitter: safeProjectUrl(data.twitter), telegram: safeProjectUrl(data.telegram) };
  } catch { return {}; }
}
