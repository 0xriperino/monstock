"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAccount, useConfig, useConnect, useSwitchChain } from "wagmi";
import { getWalletClient } from "wagmi/actions";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { TransactionReceipt, WalletClient } from "viem";
import type { StockBackUIActions, StockBackUIData, TradeQuote, TradeRequest } from "../types/ui";
import { chain, deploymentReady, publicClient, stockAddress, quoteAssets, launcherAddress, legacyLauncherAddresses, bondingCurveMode } from "../lib/chain";
import { emptyData, errorMessage, StockBackClient } from "../lib/stockback";

export function useStockBack() {
  const account = useAccount();
  const config = useConfig();
  const { connectors, connectAsync, isPending: connecting } = useConnect();
  const { switchChainAsync } = useSwitchChain();
  const queries = useQueryClient();
  const [assetId, setAssetId] = useState<string>(stockAddress ?? quoteAssets[0]?.id ?? "");
  const asset = quoteAssets.find(a => a.id.toLowerCase() === assetId.toLowerCase());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [quote, setQuote] = useState<TradeQuote | null>(null);
  const [transaction, setTransaction] = useState<StockBackUIData["transaction"]>({ status: "idle" });
  const locked = useRef(false);
  const quoteSequence = useRef(0);
  const session = `${account.address ?? ""}:${account.chainId ?? ""}:${assetId}`;
  const activeSession = useRef(session);
  activeSession.current = session;
  useEffect(() => { setQuote(null); setTransaction({ status: "idle" }); quoteSequence.current++; }, [session]);
  const client = useMemo(() => asset ? new StockBackClient(
    publicClient, chain, asset.id, asset.factory,
    async () => await getWalletClient(config, { chainId: chain.id }) as WalletClient,
    (label, hash) => { if (activeSession.current === session) setTransaction({ status: "pending", label, hash, explorerUrl: hash && chain.blockExplorers ? `${chain.blockExplorers.default.url}/tx/${hash}` : undefined }); },
    quoteAssets, launcherAddress, legacyLauncherAddresses, bondingCurveMode,
  ) : null, [config, session, asset]);

  const snapshot = useQuery({
    queryKey: ["stockback", chain.id, assetId, account.address, selectedId],
    queryFn: () => client!.snapshot(account.address, selectedId),
    enabled: Boolean(client), refetchInterval: 15_000,
  });
  const unavailable = "Contracts have not been deployed/configured for this network yet.";
  // Never reuse another account's cached financial values, even during reconnect.
  const data: StockBackUIData = snapshot.error ? emptyData(chain.name, errorMessage(snapshot.error))
    : snapshot.data ? { ...snapshot.data, wallet: { ...snapshot.data.wallet }, vault: { ...snapshot.data.vault } }
    : emptyData(chain.name, deploymentReady ? undefined : unavailable);
  data.wallet.status = connecting || account.status === "connecting" || account.status === "reconnecting" ? "connecting" : account.isConnected ? "connected" : "disconnected";
  data.wallet.address = account.address ?? null;
  data.wallet.networkStatus = !account.isConnected ? "unknown" : account.chainId === chain.id ? "correct" : "wrong";
  data.launchAvailable = Boolean(launcherAddress);
  data.quoteAssets = quoteAssets;
  if (asset) data.stockToken = asset;
  data.tradeQuote = quote;
  data.transaction = transaction;

  function requireClient() {
    if (!client) throw new Error(unavailable);
    return client;
  }
  function selectedMarket() {
    if (!data.selectedMarketId) throw new Error("Select a market before depositing.");
    return data.selectedMarketId;
  }
  async function action(label: string, operation: () => Promise<TransactionReceipt | void>) {
    if (locked.current) throw new Error("Complete the current wallet action first.");
    locked.current = true;
    const startedSession = activeSession.current;
    setTransaction({ status: "pending", label });
    try {
      const receipt = await operation();
      // Connection/network operations are not chain transactions and must not claim a receipt.
      if (startedSession === activeSession.current) setTransaction(receipt
        ? { status: "success", label, message: `${label} confirmed.`, hash: receipt.transactionHash, explorerUrl: chain.blockExplorers ? `${chain.blockExplorers.default.url}/tx/${receipt.transactionHash}` : undefined }
        : { status: "idle" });
      setQuote(null);
      quoteSequence.current++;
      await queries.invalidateQueries({ queryKey: ["stockback", chain.id] });
    } catch (error) {
      if (startedSession === activeSession.current) setTransaction({ status: "error", label, message: errorMessage(error) });
      throw new Error(errorMessage(error));
    } finally { locked.current = false; }
  }
  const requestTradeQuote = useCallback(async (request: TradeRequest) => {
    const sequence = ++quoteSequence.current;
    const requestedSession = session;
    setQuote({ ...request, id: "loading", status: "loading", outputAmount: null, minimumOutput: null, feeAmount: null, expiresAt: 0 });
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      if (!client) throw new Error("Contracts have not been deployed/configured for this network yet.");
      const next = await Promise.race([
        client.quote(request),
        new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error("Estimate timed out. Refresh the estimate to retry.")), 15_000); }),
      ]);
      if (sequence === quoteSequence.current && requestedSession === activeSession.current) setQuote(next);
    } catch (error) {
      if (sequence === quoteSequence.current && requestedSession === activeSession.current) setQuote({ ...request, id: "error", status: "error", outputAmount: null, minimumOutput: null, feeAmount: null, expiresAt: 0, error: errorMessage(error) });
    } finally { clearTimeout(timeout); }
  }, [client, session]);
  const actions: StockBackUIActions = {
    selectQuoteAsset: id => {
      if (locked.current) throw new Error("Complete the current wallet action first.");
      if (!quoteAssets.some(a => a.id.toLowerCase() === id.toLowerCase())) throw new Error("Unknown quote asset.");
      setAssetId(id); setSelectedId(null); setQuote(null); quoteSequence.current++;
    },
    connectWallet: () => action("Connect wallet", async () => {
      const connector = connectors.find(c => c.type === "injected");
      if (!connector || !await connector.getProvider()) throw new Error("Install or enable an Ethereum-compatible browser wallet, then reconnect.");
      await connectAsync({ connector });
    }),
    switchNetwork: () => action(`Switch to ${chain.name}`, async () => { await switchChainAsync({ chainId: chain.id }); }),
    requestFaucet: () => action(`Claim test ${data.stockToken.symbol}`, () => requireClient().faucet()),
    createCoin: params => action("Create coin", () => {
      if (params.stockTokenId && params.stockTokenId.toLowerCase() !== assetId.toLowerCase()) throw new Error("Quote asset changed. Review your pair and retry.");
      if (bondingCurveMode) return requireClient().launchCurveCoin(params);
      return params.metadata !== undefined || params.devBuyAmount !== undefined
        ? requireClient().launchCoin(params)
        : requireClient().createCoin(params.name, params.symbol, params.initialStockLiquidity ?? "0");
    }),
    selectMarket: marketId => {
      if (locked.current) throw new Error("Complete the current wallet action first.");
      const market = data.markets.find(m => m.id.toLowerCase() === marketId.toLowerCase());
      if (!market) throw new Error("Unknown market.");
      if (market.stockToken) setAssetId(market.stockToken.id);
      setSelectedId(marketId); setQuote(null); quoteSequence.current++;
    },
    approveStock: params => action(`Approve ${data.stockToken.symbol}`, async () => { const c = requireClient(); const p = await c.pool(params.marketId); return c.approve(p.stock, p.market, params.amount); }),
    approveMeme: params => action("Approve meme tokens", async () => { const c = requireClient(); const p = await c.pool(params.marketId); return c.approve(p.meme, p.market, params.amount); }),
    buy: params => action("Buy meme tokens", () => { if (params.side !== "buy") throw new Error("Trade direction mismatch."); return requireClient().trade(params); }),
    sell: params => action("Sell meme tokens", () => { if (params.side !== "sell") throw new Error("Trade direction mismatch."); return requireClient().trade(params); }),
    settleEpoch: id => action("Settle epoch", () => requireClient().settle(id)),
    claimHolderRewards: id => action("Claim holder rewards", () => requireClient().claim(id)),
    approveVault: amount => action("Approve StockVault", async () => { const c = requireClient(); const p = await c.pool(selectedMarket()); return c.approve(p.stock, p.vault, amount); }),
    depositToVault: params => action("Deposit into StockVault", () => requireClient().deposit(selectedMarket(), params.amount, params.lockDays)),
    withdrawFromVault: id => action("Withdraw position", () => requireClient().withdraw(id)),
    requestTradeQuote,
  };
  return { data, actions, deploymentReady, refresh: () => snapshot.refetch() };
}
