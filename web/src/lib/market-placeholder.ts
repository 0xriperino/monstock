import type { StockBackUIData, TokenInfo } from "../types/ui";
import { emptyData } from "./stockback";

/** Keep public markets visible during selection/account changes. Financial
 * permissions and balances must always come from the new query's own result. */
export function marketPlaceholder(previous: StockBackUIData | undefined, asset: TokenInfo | undefined, selectedId: string | null): StockBackUIData | undefined {
  if (!previous) return;
  const next = emptyData(previous.wallet.networkName);
  next.stockToken = asset ?? previous.stockToken;
  next.quoteAssets = previous.quoteAssets;
  next.marketsStatus = previous.marketsStatus;
  next.markets = previous.markets.map(market => ({ ...market, walletBalance: null, claimableRewards: null,
    stockApproval: { status: "unknown", allowance: null }, memeApproval: { status: "unknown", allowance: null }, nativeMemeApproval: { status: "unknown", allowance: null } }));
  next.selectedMarketId = next.markets.find(market => market.id === selectedId && (market.stockToken ?? next.stockToken).id.toLowerCase() === next.stockToken.id.toLowerCase())?.id
    ?? next.markets.find(market => (market.stockToken ?? next.stockToken).id.toLowerCase() === next.stockToken.id.toLowerCase())?.id ?? null;
  return next;
}
