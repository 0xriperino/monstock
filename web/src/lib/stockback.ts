import { BaseError, formatUnits, getAddress, isAddress, parseUnits, type Abi, type Address, type Chain, type PublicClient, type TransactionReceipt, type WalletClient } from "viem";
import { factoryAbi, marketAbi, memeAbi, stockAbi, vaultAbi } from "./abis";
import type { ExecuteTradeParams, StockBackUIData, StockBackMarket, TokenApproval, TradeQuote, TradeRequest, VaultPosition, TokenInfo } from "../types/ui";

export function errorMessage(error: unknown): string {
  return error instanceof BaseError ? error.shortMessage : error instanceof Error ? error.message : "The action could not complete.";
}
export function amountUnits(value: string): bigint {
  if (!/^\d+(\.\d{1,18})?$/.test(value)) throw new Error("Enter a positive amount with up to 18 decimals.");
  const amount = parseUnits(value, 18);
  if (amount <= 0n || amount >= 2n ** 256n) throw new Error("Amount is outside the supported range.");
  return amount;
}
const human = (value: bigint) => formatUnits(value, 18);
const approval = (value: bigint): TokenApproval => ({ status: value > 0n ? "approved" : "required", allowance: human(value) });
const unknownApproval: TokenApproval = { status: "unknown", allowance: null };

export function emptyData(networkName: string, message?: string): StockBackUIData {
  return {
    wallet: { status: "disconnected", address: null, networkStatus: "unknown", networkName, stockBalance: null, balancesStatus: message ? "error" : "loading", balancesError: message, faucetAvailable: false },
    stockToken: { id: "", name: "Mock Stock", symbol: "MockSPYx", decimals: 18 },
    markets: [], marketsStatus: message ? "error" : "loading", marketsError: message, selectedMarketId: null, tradeQuote: null, slippageBps: 50,
    vault: { approval: unknownApproval, positions: [], positionsStatus: message ? "error" : "loading", positionsError: message, totalLockedPrincipal: null, earnedRewards: null },
    portfolio: { claimableHolderRewards: null }, transaction: { status: "idle" },
  };
}

export type QuoteAssetConfig = TokenInfo & { id: Address; factory: Address };
type Pool = { market: Address; meme: Address; vault: Address; stock: Address; stockToken: TokenInfo };
type Pending = (label: string, hash?: `0x${string}`) => void;

/** Browser-only integration; contracts and confirmed receipts are the source of truth. */
export class StockBackClient {
  private quotes = new Map<string, TradeQuote>();
  constructor(
    readonly client: PublicClient,
    readonly chain: Chain,
    readonly stock: Address,
    readonly factory: Address,
    readonly wallet: () => Promise<WalletClient>,
    readonly onPending: Pending = () => {},
    readonly assets: readonly QuoteAssetConfig[] = [{ id: stock, factory, name: "Mock Stock", symbol: "MockSPYx", decimals: 18 }],
  ) {}

  async assertDeployment() {
    if (await this.client.getChainId() !== this.chain.id) throw new Error("RPC chain does not match the configured network.");
    const [stockCode, factoryCode, stock] = await Promise.all([
      this.client.getCode({ address: this.stock }), this.client.getCode({ address: this.factory }),
      this.client.readContract({ address: this.factory, abi: factoryAbi, functionName: "stockToken" }),
    ]);
    if (!stockCode || !factoryCode || getAddress(stock) !== getAddress(this.stock)) throw new Error("Deployment addresses do not match deployed StockBack contracts.");
  }

  async pools(): Promise<Pool[]> {
    const groups = await Promise.all(this.assets.map(async asset => {
      const markets = await this.client.readContract({ address: asset.factory, abi: factoryAbi, functionName: "getMarkets" });
      return Promise.all(markets.map(async market => {
        const [meme, vault, stock] = await Promise.all([
          this.client.readContract({ address: market, abi: marketAbi, functionName: "memeToken" }),
          this.client.readContract({ address: market, abi: marketAbi, functionName: "vault" }),
          this.client.readContract({ address: market, abi: marketAbi, functionName: "stockToken" }),
        ]);
        if (getAddress(stock) !== getAddress(asset.id)) throw new Error("Market uses an unexpected quote asset.");
        return { market, meme, vault, stock, stockToken: asset };
      }));
    }));
    return groups.flat();
  }

  async pool(id: string) {
    if (!isAddress(id)) throw new Error("Invalid market.");
    const pool = (await this.pools()).find(p => p.market.toLowerCase() === id.toLowerCase());
    if (!pool) throw new Error("Market is not registered with this Factory.");
    return pool;
  }

  async snapshot(user?: Address, selectedId?: string | null): Promise<StockBackUIData> {
    await this.assertDeployment();
    const pools = (await this.pools()).filter(p => p.stock.toLowerCase() === this.stock.toLowerCase());
    const selected = pools.find(p => p.market.toLowerCase() === selectedId?.toLowerCase()) ?? pools[0];
    const block = await this.client.getBlock();
    const data = emptyData(this.chain.name);
    const [stockBalance, claimed] = user ? await Promise.all([
      this.client.readContract({ address: this.stock, abi: stockAbi, functionName: "balanceOf", args: [user] }),
      this.client.readContract({ address: this.stock, abi: stockAbi, functionName: "hasClaimed", args: [user] }),
    ]) : [null, true];
    let totalHolder = 0n;
    let totalPrincipal = 0n;
    let totalVaultReward = 0n;
    const positions: VaultPosition[] = [];
    const markets = await Promise.all(pools.map(async pool => {
      const [name, symbol, reserves, epoch] = await Promise.all([
        this.client.readContract({ address: pool.meme, abi: memeAbi, functionName: "name" }),
        this.client.readContract({ address: pool.meme, abi: memeAbi, functionName: "symbol" }),
        this.client.readContract({ address: pool.market, abi: marketAbi, functionName: "getReserves" }),
        this.client.readContract({ address: pool.market, abi: marketAbi, functionName: "nextEpochAt" }),
      ]);
      const [balance, rewards, stockAllowance, memeAllowance] = user ? await Promise.all([
        this.client.readContract({ address: pool.meme, abi: memeAbi, functionName: "balanceOf", args: [user] }),
        this.client.readContract({ address: pool.market, abi: marketAbi, functionName: "pendingHolderRewards", args: [user] }),
        this.client.readContract({ address: this.stock, abi: stockAbi, functionName: "allowance", args: [user, pool.market] }),
        this.client.readContract({ address: pool.meme, abi: memeAbi, functionName: "allowance", args: [user, pool.market] }),
      ]) : [null, null, null, null];
      if (user) {
        const owned = await this.client.readContract({ address: pool.vault, abi: vaultAbi, functionName: "getPositions", args: [user] });
        await Promise.all(owned.filter(p => !p.withdrawn).map(async p => {
          const reward = await this.client.readContract({ address: pool.vault, abi: vaultAbi, functionName: "pendingRewards", args: [p.id] });
          const days = Number((p.unlockAt - p.startAt) / 86400n);
          if (days !== 30 && days !== 90 && days !== 180) throw new Error("Unsupported vault lock period.");
          totalPrincipal += p.amount;
          totalVaultReward += reward;
          positions.push({ id: `${pool.vault}:${p.id}`, principal: human(p.amount), lockDays: days, unlocksAt: Number(p.unlockAt) * 1000, earnedRewards: human(reward), canWithdraw: block.timestamp >= p.unlockAt, isWithdrawing: false });
        }));
      }
      totalHolder += rewards ?? 0n;
      return {
        id: pool.market, stockToken: pool.stockToken, token: { id: pool.meme, name, symbol, decimals: 18 }, stockReserve: human(reserves[0]), memeReserve: human(reserves[1]),
        estimatedPrice: reserves[1] > 0n ? human(reserves[0] * 10n ** 18n / reserves[1]) : null,
        walletBalance: balance === null ? null : human(balance), claimableRewards: rewards === null ? null : human(rewards),
        stockApproval: stockAllowance === null ? unknownApproval : approval(stockAllowance), memeApproval: memeAllowance === null ? unknownApproval : approval(memeAllowance),
        epoch: { endsAt: Number(epoch) * 1000, canSettle: block.timestamp >= epoch, isSettling: false },
      } satisfies StockBackMarket;
    }));
    data.stockToken = this.assets.find(a => a.id.toLowerCase() === this.stock.toLowerCase()) ?? { ...data.stockToken, id: this.stock };
    data.quoteAssets = [...this.assets];
    data.wallet = { ...data.wallet, status: user ? "connected" : "disconnected", address: user ?? null, stockBalance: stockBalance === null ? null : human(stockBalance), balancesStatus: "ready", faucetAvailable: Boolean(user && !claimed) };
    data.markets = markets;
    data.marketsStatus = "ready";
    data.selectedMarketId = selected?.market ?? null;
    const vaultAllowance = user && selected ? await this.client.readContract({ address: this.stock, abi: stockAbi, functionName: "allowance", args: [user, selected.vault] }) : null;
    data.vault = { approval: vaultAllowance === null ? unknownApproval : approval(vaultAllowance), positions: positions.sort((a, b) => a.id.localeCompare(b.id)), positionsStatus: "ready", totalLockedPrincipal: user ? human(totalPrincipal) : null, earnedRewards: user ? human(totalVaultReward) : null };
    data.portfolio.claimableHolderRewards = user ? human(totalHolder) : null;
    return data;
  }

  private async signer() {
    const wallet = await this.wallet();
    if (!wallet.account) throw new Error("Connect a wallet first.");
    if (await wallet.getChainId() !== this.chain.id) throw new Error(`Switch to ${this.chain.name} first.`);
    if (await this.client.getChainId() !== this.chain.id) throw new Error("RPC chain mismatch.");
    const accounts = await wallet.getAddresses();
    if (!accounts.some(address => address.toLowerCase() === wallet.account!.address.toLowerCase())) throw new Error("Wallet account changed. Reconnect and retry.");
    return { wallet, account: wallet.account };
  }

  private async send(label: string, address: Address, abi: Abi, functionName: string, args: readonly unknown[] = []): Promise<TransactionReceipt> {
    this.onPending(label);
    const { wallet, account } = await this.signer();
    const simulation = await this.client.simulateContract({ address, abi, functionName, args, account });
    const hash = await wallet.writeContract({ ...simulation.request, account, chain: this.chain });
    this.onPending(label, hash);
    const receipt = await this.client.waitForTransactionReceipt({ hash, confirmations: 1 });
    if (receipt.status !== "success") throw new Error(`${label} reverted on chain (${hash}).`);
    return receipt;
  }

  async approve(token: Address, spender: Address, amount: string) {
    return this.send("Approve token spending", token, stockAbi, "approve", [spender, amountUnits(amount)]);
  }
  async faucet() {
    const { account } = await this.signer();
    if (await this.client.readContract({ address: this.stock, abi: stockAbi, functionName: "hasClaimed", args: [account.address] })) throw new Error("This wallet has already claimed the faucet.");
    return this.send(`Claim test ${this.assets.find(a => a.id.toLowerCase() === this.stock.toLowerCase())?.symbol ?? "quote tokens"}`, this.stock, stockAbi, "faucet");
  }
  async createCoin(name: string, symbol: string, liquidity: string) {
    if (!name.trim() || !symbol.trim()) throw new Error("Name and symbol are required.");
    const amount = amountUnits(liquidity);
    const { account } = await this.signer();
    await this.checkSpend(this.stock, account.address, this.factory, amount, false);
    const allowance = await this.client.readContract({ address: this.stock, abi: stockAbi, functionName: "allowance", args: [account.address, this.factory] });
    if (allowance < amount) await this.approve(this.stock, this.factory, liquidity);
    return this.send("Create coin and market", this.factory, factoryAbi, "createCoin", [name.trim(), symbol.trim(), amount]);
  }
  private async checkSpend(token: Address, user: Address, spender: Address, amount: bigint, requireApproval = true) {
    const [balance, allowance] = await Promise.all([
      this.client.readContract({ address: token, abi: stockAbi, functionName: "balanceOf", args: [user] }),
      this.client.readContract({ address: token, abi: stockAbi, functionName: "allowance", args: [user, spender] }),
    ]);
    if (balance < amount) throw new Error("Insufficient token balance.");
    if (requireApproval && allowance < amount) throw new Error("Approve the required amount before continuing.");
  }

  async quote(request: TradeRequest): Promise<TradeQuote> {
    if (!Number.isInteger(request.slippageBps) || request.slippageBps < 0 || request.slippageBps >= 10000) throw new Error("Invalid slippage.");
    const pool = await this.pool(request.marketId);
    const amount = amountUnits(request.amount);
    const blockNumber = await this.client.getBlockNumber({ cacheTime: 0 });
    const [output, reserves] = await Promise.all([
      request.side === "buy"
        ? this.client.readContract({ address: pool.market, abi: marketAbi, functionName: "quoteBuy", args: [amount], blockNumber })
        : this.client.readContract({ address: pool.market, abi: marketAbi, functionName: "quoteSell", args: [amount], blockNumber }),
      this.client.readContract({ address: pool.market, abi: marketAbi, functionName: "getReserves", blockNumber }),
    ]);
    const minimum = output * BigInt(10000 - request.slippageBps) / 10000n;
    if (minimum === 0n) throw new Error("Amount is too small to quote.");
    const gross = request.side === "buy" ? amount : reserves[0] * amount / (reserves[1] + amount);
    const quote: TradeQuote = { ...request, id: crypto.randomUUID(), status: "ready", outputAmount: human(output), minimumOutput: human(minimum), feeAmount: human(gross / 100n), expiresAt: Date.now() + 45_000 };
    for (const [id, old] of this.quotes) if (old.expiresAt <= Date.now()) this.quotes.delete(id);
    if (this.quotes.size >= 32) this.quotes.delete(this.quotes.keys().next().value!);
    this.quotes.set(quote.id, quote);
    return quote;
  }

  async trade(params: ExecuteTradeParams) {
    const quote = this.quotes.get(params.quoteId);
    if (!quote || quote.expiresAt <= Date.now() || quote.side !== params.side || quote.marketId.toLowerCase() !== params.marketId.toLowerCase()
      || amountUnits(quote.amount) !== amountUnits(params.amount) || quote.slippageBps !== params.slippageBps || quote.minimumOutput !== params.minimumOutput) throw new Error("Quote changed or expired. Refresh the estimate.");
    const pool = await this.pool(params.marketId);
    const { account } = await this.signer();
    const amount = amountUnits(params.amount);
    const minimum = amountUnits(params.minimumOutput);
    await this.checkSpend(params.side === "buy" ? pool.stock : pool.meme, account.address, pool.market, amount);
    const output = await this.client.readContract({ address: pool.market, abi: marketAbi, functionName: params.side === "buy" ? "quoteBuy" : "quoteSell", args: [amount] });
    if (output < minimum) throw new Error("Market price moved beyond your slippage limit. Refresh the estimate.");
    const receipt = await this.send(params.side === "buy" ? "Buy meme tokens" : "Sell meme tokens", pool.market, marketAbi, params.side, [amount, minimum]);
    this.quotes.delete(params.quoteId);
    return receipt;
  }

  async settle(id: string) {
    const pool = await this.pool(id);
    const [at, block] = await Promise.all([this.client.readContract({ address: pool.market, abi: marketAbi, functionName: "nextEpochAt" }), this.client.getBlock()]);
    if (block.timestamp < at) throw new Error("This epoch is not ready to settle.");
    return this.send("Settle market epoch", pool.market, marketAbi, "settleEpoch");
  }
  async claim(id: string) {
    const pool = await this.pool(id);
    const { account } = await this.signer();
    if (await this.client.readContract({ address: pool.market, abi: marketAbi, functionName: "pendingHolderRewards", args: [account.address] }) === 0n) throw new Error("No holder rewards are claimable.");
    return this.send("Claim holder rewards", pool.market, marketAbi, "claimHolderRewards");
  }
  async deposit(id: string, amount: string, lockDays: number) {
    if (![30, 90, 180].includes(lockDays)) throw new Error("Choose a 30, 90, or 180 day lock.");
    const pool = await this.pool(id);
    const { account } = await this.signer();
    await this.checkSpend(pool.stock, account.address, pool.vault, amountUnits(amount));
    return this.send("Deposit into StockVault", pool.vault, vaultAbi, "deposit", [amountUnits(amount), BigInt(lockDays)]);
  }
  async withdraw(positionId: string) {
    const [vault, id] = positionId.split(":");
    if (!isAddress(vault) || !/^\d+$/.test(id ?? "")) throw new Error("Invalid position.");
    if (!(await this.pools()).some(p => p.vault.toLowerCase() === vault.toLowerCase())) throw new Error("Unknown vault.");
    const { account } = await this.signer();
    const positions = await this.client.readContract({ address: vault, abi: vaultAbi, functionName: "getPositions", args: [account.address] });
    const position = positions.find(p => p.id === BigInt(id));
    if (!position || position.withdrawn) throw new Error("Position is not available to this wallet.");
    if ((await this.client.getBlock()).timestamp < position.unlockAt) throw new Error("Position is still locked. Early withdrawal is not possible.");
    return this.send("Withdraw unlocked position", vault, vaultAbi, "withdraw", [position.id]);
  }
}
