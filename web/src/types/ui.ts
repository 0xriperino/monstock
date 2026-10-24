/** Human-readable decimal strings, never wei or JS floating point amounts. */
export type TokenAmount = string;
export type MaybePromise<T = void> = T | Promise<T>;
export type StockBackView = "launchpad" | "launch" | "trading" | "autovault" | "portfolio";
export type LoadStatus = "loading" | "ready" | "error";
export type LockDays = 30 | 90 | 180;
export type TradeSide = "buy" | "sell";

export interface TokenInfo {
  id: string;
  name: string;
  symbol: string;
  decimals: number;
  image?: string;
  website?: string;
  twitter?: string;
  telegram?: string;
}

export interface StockBackMarket {
  id: string;
  token: TokenInfo;
  stockToken?: TokenInfo;
  tradingFeeBps?: number;
  stockReserve: TokenAmount;
  memeReserve: TokenAmount;
  /** Estimated quote tokens per one meme token. Null means unavailable. */
  estimatedPrice: TokenAmount | null;
  walletBalance: TokenAmount | null;
  claimableRewards: TokenAmount | null;
  stockApproval: TokenApproval;
  memeApproval: TokenApproval;
  epoch: {
    /** Unix timestamp in milliseconds; always supplied by integration. */
    endsAt: number;
    canSettle: boolean;
    isSettling: boolean;
  };
}

export interface TokenApproval {
  status: "unknown" | "required" | "approving" | "approved" | "error";
  /** Approved human-readable spend amount, including when status is approved. */
  allowance: TokenAmount | null;
  error?: string;
}

export interface TradeRequest {
  marketId: string;
  side: TradeSide;
  /** Exact input: quote tokens for buy, meme tokens for sell. */
  amount: TokenAmount;
  slippageBps: number;
}

export interface TradeQuote extends TradeRequest {
  id: string;
  status: LoadStatus;
  outputAmount: TokenAmount | null;
  minimumOutput: TokenAmount | null;
  /** Fee in quote tokens on both buy and sell, as charged by MemeMarket. */
  feeAmount: TokenAmount | null;
  expiresAt: number;
  error?: string;
}

export interface ExecuteTradeParams extends TradeRequest {
  quoteId: string;
  minimumOutput: TokenAmount;
}

export interface CreateCoinParams {
  name: string;
  symbol: string;
  stockTokenId?: string;
  initialStockLiquidity: TokenAmount;
  devBuyAmount?: TokenAmount;
  tradingFeeBps?: 100 | 300;
  metadata?: { image?: string; website?: string; twitter?: string; telegram?: string };
}

export interface DepositToVaultParams {
  amount: TokenAmount;
  lockDays: LockDays;
}

export interface VaultPosition {
  id: string;
  principal: TokenAmount;
  lockDays: LockDays;
  unlocksAt: number;
  earnedRewards: TokenAmount | null;
  /** Contract eligibility is required in addition to elapsed lock time. */
  canWithdraw: boolean;
  isWithdrawing: boolean;
}

export interface StockBackUIData {
  /** Optional initial tab. Navigation afterward is local UI state. */
  initialView?: StockBackView;
  /** Optional synthetic fixture banner; omit for integration. */
  preview?: boolean;
  wallet: {
    status: "disconnected" | "connecting" | "connected";
    address: string | null;
    networkStatus: "correct" | "wrong" | "unknown";
    networkName: string;
    stockBalance: TokenAmount | null;
    balancesStatus: LoadStatus;
    balancesError?: string;
    faucetAvailable: boolean;
  };
  launchAvailable?: boolean;
  quoteAssets?: TokenInfo[];
  stockToken: TokenInfo;
  markets: StockBackMarket[];
  marketsStatus: LoadStatus;
  marketsError?: string;
  selectedMarketId: string | null;
  /** Quotes must match market, side, amount AND slippage before execution. */
  tradeQuote: TradeQuote | null;
  slippageBps: number;
  vault: {
    approval: TokenApproval;
    positions: VaultPosition[];
    positionsStatus: LoadStatus;
    positionsError?: string;
    /** Integration-provided totals; UI never invents P&L or reward estimates. */
    totalLockedPrincipal: TokenAmount | null;
    earnedRewards: TokenAmount | null;
  };
  portfolio: {
    claimableHolderRewards: TokenAmount | null;
  };
  transaction: {
    status: "idle" | "pending" | "success" | "error";
    label?: string;
    message?: string;
    hash?: string;
    explorerUrl?: string;
  };
}

/** All signing, allowance checks, quoting and chain revalidation belong to Developer 4.
 * Promise resolution alone is NEVER interpreted by the UI as transaction success.
 * Integrations must revalidate balances, allowances, quote freshness and unlock
 * eligibility at execution time. Display guards do not replace contract checks.
 */
export interface StockBackUIActions {
  selectQuoteAsset?: (assetId: string) => MaybePromise;
  connectWallet: () => MaybePromise;
  switchNetwork: () => MaybePromise;
  requestFaucet: () => MaybePromise;
  createCoin: (params: CreateCoinParams) => MaybePromise;
  selectMarket: (marketId: string) => MaybePromise;
  approveStock: (params: { marketId: string; amount: TokenAmount }) => MaybePromise;
  approveMeme: (params: { marketId: string; amount: TokenAmount }) => MaybePromise;
  buy: (params: ExecuteTradeParams) => MaybePromise;
  sell: (params: ExecuteTradeParams) => MaybePromise;
  settleEpoch: (marketId: string) => MaybePromise;
  claimHolderRewards: (marketId: string) => MaybePromise;
  approveVault: (amount: TokenAmount) => MaybePromise;
  depositToVault: (params: DepositToVaultParams) => MaybePromise;
  withdrawFromVault: (positionId: string) => MaybePromise;
  /** Optional asynchronous quoting bridge, called when the user edits trade input.
   * Publish the resulting quote in data.tradeQuote; stale responses are ignored.
   * Without this callback, trade execution remains disabled.
   */
  requestTradeQuote?: (params: TradeRequest) => MaybePromise;
}

export interface StockBackAppProps {
  data: StockBackUIData;
  actions: StockBackUIActions;
}
