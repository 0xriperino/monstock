import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import { createPublicClient, defineChain, fallback, getAddress, isAddress } from "viem";
import { monadTestnet } from "viem/chains";
import nativeDeployment from "../../../shared/native-router.json";
import launcherDeployment from "../../../shared/launcher.json";
import registry from "../../../shared/assets.json";
import type { QuoteAssetConfig } from "./stockback";
import deployments from "../../../shared/deployments.json";
import { rateLimitedHttp } from "./rpc";

export const localMode = process.env.NEXT_PUBLIC_USE_ANVIL === "true";
// Every registered market was deployed after the original application contracts.
// The public RPC does not retain state from before the current testnet history.
export const marketHistoryStartBlock = localMode ? 0n : BigInt(deployments.transactions[0].blockNumber);
export const chain = defineChain({
  id: Number(localMode ? 31337 : 10143),
  name: localMode ? "StockBack Local (Anvil)" : "Monad Testnet",
  nativeCurrency: { name: localMode ? "Test Ether" : "Monad", symbol: localMode ? "ETH" : "MON", decimals: 18 },
  rpcUrls: { default: { http: [process.env.NEXT_PUBLIC_RPC_URL || (localMode ? "http://127.0.0.1:8545" : "https://testnet-rpc.monad.xyz")] } },
  ...(!localMode ? { blockExplorers: { default: { name: "Monadscan", url: "https://testnet.monadscan.com" } } } : {}),
  testnet: true,
  ...(!localMode ? { contracts: monadTestnet.contracts } : {}),
});

export function configuredAddress(value: string | null | undefined) {
  return value && isAddress(value) && value !== "0x0000000000000000000000000000000000000000" ? getAddress(value) : undefined;
}
export const stockAddress = configuredAddress(process.env.NEXT_PUBLIC_STOCK_TOKEN_ADDRESS || (!localMode ? deployments.contracts.stockToken : null));
export const factoryAddress = configuredAddress(process.env.NEXT_PUBLIC_FACTORY_ADDRESS || (!localMode ? deployments.contracts.factory : null));
export const deploymentReady = Boolean(stockAddress && factoryAddress);
const primaryRpc = chain.rpcUrls.default.http[0];
const backupRpc = process.env.NEXT_PUBLIC_FALLBACK_RPC_URL || (!localMode && new URL(primaryRpc).hostname === "testnet-rpc.monad.xyz" ? "https://monad-testnet.drpc.org" : undefined);
export const publicClient = createPublicClient({ chain, batch: { multicall: { wait: 10, batchSize: 4096 } },
  transport: backupRpc ? fallback([rateLimitedHttp(primaryRpc, { retryCount: 0 }), rateLimitedHttp(backupRpc, { retryCount: 0 })], { retryCount: 2, retryDelay: 1000 }) : rateLimitedHttp(primaryRpc) });
// Historical state/log support varies by provider. Keep the verified history
// source separate from low-latency latest-state failover.
export const historyClient = createPublicClient({ chain, transport: rateLimitedHttp(primaryRpc, { retryCount: 1 }) });
export const wagmiConfig = createConfig({ chains: [chain], connectors: [injected()], transports: { [chain.id]: http(chain.rpcUrls.default.http[0]) }, ssr: true });

const registryAssets = process.env.NEXT_PUBLIC_QUOTE_ASSETS_JSON
  ? JSON.parse(process.env.NEXT_PUBLIC_QUOTE_ASSETS_JSON) as QuoteAssetConfig[]
  : localMode ? [] : registry.assets;
export const quoteAssets: QuoteAssetConfig[] = registryAssets.map(asset => {
  const id = configuredAddress(asset.id);
  const factory = configuredAddress(asset.factory);
  if (!id || !factory || asset.decimals !== 18 || !asset.symbol || !asset.name) throw new Error("Invalid quote asset configuration.");
  return { ...asset, id, factory };
});
if (stockAddress && factoryAddress && !quoteAssets.some(a => a.id.toLowerCase() === stockAddress.toLowerCase())) {
  quoteAssets.unshift({ id: stockAddress, factory: factoryAddress, name: "S&P 500", symbol: "SPYX", decimals: 18, logo: "/assets/quotes/spyx.png" });
}

export const launcherAddress = configuredAddress(process.env.NEXT_PUBLIC_LAUNCHER_ADDRESS || (!localMode ? launcherDeployment.address : null));

const launcherHistory = launcherDeployment as { legacyLaunchers?: string[]; model?: string };
export const legacyLauncherAddresses = localMode ? [] : (launcherHistory.legacyLaunchers ?? []).map(configuredAddress).filter((address): address is `0x${string}` => Boolean(address));
export const bondingCurveMode = process.env.NEXT_PUBLIC_BONDING_CURVE === "true" || (!localMode && launcherHistory.model === "bonding-curve");

export const nativeRouterAddress = configuredAddress(process.env.NEXT_PUBLIC_NATIVE_ROUTER_ADDRESS || (!localMode ? nativeDeployment.address : null));
