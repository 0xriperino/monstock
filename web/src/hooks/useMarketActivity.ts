"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { isAddress } from "viem";
import { chain, historyClient, marketHistoryStartBlock } from "../lib/chain";
import { readMarketActivity, type MarketTrade } from "../lib/market-activity";
import type { StockBackMarket } from "../types/ui";

export function useMarketActivity(market?: StockBackMarket) {
  const [progress, setProgress] = useState({ market: "", percent: 0 });
  const [preview, setPreview] = useState<{ market: string; trades: MarketTrade[] }>();
  const query = useQuery({
    queryKey: ["stockback", chain.id, "activity", market?.id, market?.token.id],
    queryFn: ({ signal }) => {
      if (!market || !isAddress(market.id) || !isAddress(market.token.id)) throw new Error("Select a deployed token to load market activity.");
      return readMarketActivity(historyClient, chain.id, market.id, market.token.id, marketHistoryStartBlock, {
        signal,
        onProgress: percent => setProgress({ market: market.id, percent: Math.floor(percent) }),
        onPreview: trades => setPreview({ market: market.id, trades }),
      });
    },
    enabled: Boolean(market && isAddress(market.id) && isAddress(market.token.id)),
    refetchInterval: 5_000,
    staleTime: 4_000,
    retry: 1,
  });
  return { ...query, progress: progress.market === market?.id ? progress.percent : 0,
    previewTrades: preview && preview.market === market?.id ? preview.trades : undefined };
}
