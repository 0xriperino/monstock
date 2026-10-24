"use client";

import { useState } from "react";
import type { StockBackUIActions, StockBackUIData } from "../../types/ui";
import { StockBackApp } from "../StockBackApp";
import { createMockUIData } from "./mock-data";

/** Development only. No signing, RPC, simulated execution, or success receipts. */
export function StockBackPreview() {
  const [data, setData] = useState<StockBackUIData>(() => createMockUIData());
  const unavailable = () => { throw new Error("Preview only. Wallet transactions are unavailable in this preview."); };
  const actions: StockBackUIActions = {
    connectWallet: unavailable, switchNetwork: unavailable, requestFaucet: unavailable,
    createCoin: unavailable,
    selectMarket: (marketId) => setData((current) => ({ ...current, selectedMarketId: marketId })),
    approveStock: unavailable, approveMeme: unavailable, buy: unavailable, sell: unavailable,
    settleEpoch: unavailable, claimHolderRewards: unavailable, approveVault: unavailable,
    depositToVault: unavailable, withdrawFromVault: unavailable,
  };
  return <StockBackApp data={data} actions={actions} />;
}
