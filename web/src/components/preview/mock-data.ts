import type { StockBackUIData } from "../../types/ui";

/** Synthetic component-development fixture. Never imported by StockBackApp. */
export function createMockUIData(now = Date.now()): StockBackUIData {
  const approval = { status: "approved", allowance: "1000000" } as const;
  return {
    preview: true,
    wallet: {
      status: "connected", address: "preview-wallet", networkStatus: "correct",
      networkName: "Monad Testnet", stockBalance: "1240.50", balancesStatus: "ready", faucetAvailable: false,
    },
    stockToken: { id: "mock-stock", name: "Mock SPYx", symbol: "MockSPYx", decimals: 18 },
    marketsStatus: "ready",
    markets: [
      { id: "market-cat", token: { id: "cat", name: "Market Cat", symbol: "MCAT", decimals: 18 }, stockReserve: "24500", memeReserve: "1250000", estimatedPrice: "0.0196", walletBalance: "4250", claimableRewards: "12.45", stockApproval: approval, memeApproval: approval, epoch: { endsAt: now + 173000, canSettle: false, isSettling: false } },
      { id: "market-bull", token: { id: "bull", name: "Purple Bull", symbol: "PBULL", decimals: 18 }, stockReserve: "18200", memeReserve: "3500000", estimatedPrice: "0.0052", walletBalance: "18000", claimableRewards: "3.80", stockApproval: approval, memeApproval: approval, epoch: { endsAt: now + 90000, canSettle: false, isSettling: false } },
      { id: "market-moon", token: { id: "moon", name: "Moon Department", symbol: "MOON", decimals: 18 }, stockReserve: "8600", memeReserve: "2000000", estimatedPrice: "0.0043", walletBalance: "0", claimableRewards: "0", stockApproval: approval, memeApproval: approval, epoch: { endsAt: now + 240000, canSettle: false, isSettling: false } },
    ],
    selectedMarketId: "market-cat", tradeQuote: null, slippageBps: 50,
    vault: {
      approval,
      positionsStatus: "ready",
      positions: [
        { id: "position-locked", principal: "500", lockDays: 90, unlocksAt: now + 60 * 86400000, earnedRewards: "8.42", canWithdraw: false, isWithdrawing: false },
        { id: "position-unlocked", principal: "250", lockDays: 30, unlocksAt: now - 86400000, earnedRewards: "2.18", canWithdraw: true, isWithdrawing: false },
      ],
      totalLockedPrincipal: "750", earnedRewards: "10.60",
    },
    portfolio: { claimableHolderRewards: "16.25" },
    transaction: { status: "idle" },
  };
}
