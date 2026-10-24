import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import { createPublicClient, defineChain, getAddress, isAddress } from "viem";
import registry from "../../../shared/assets.json";
import type { QuoteAssetConfig } from "./stockback";
import deployments from "../../../shared/deployments.json";
import { rateLimitedHttp } from "./rpc";

export const localMode = process.env.NEXT_PUBLIC_USE_ANVIL === "true";
export const chain = defineChain({
  id: Number(localMode ? 31337 : 10143),
  name: localMode ? "StockBack Local (Anvil)" : "Monad Testnet",
  nativeCurrency: { name: localMode ? "Test Ether" : "Monad", symbol: localMode ? "ETH" : "MON", decimals: 18 },
  rpcUrls: { default: { http: [process.env.NEXT_PUBLIC_RPC_URL || (localMode ? "http://127.0.0.1:8545" : "https://testnet-rpc.monad.xyz")] } },
  ...(!localMode ? { blockExplorers: { default: { name: "Monadscan", url: "https://testnet.monadscan.com" } } } : {}),
  testnet: true,
});

export function configuredAddress(value: string | null | undefined) {
  return value && isAddress(value) && value !== "0x0000000000000000000000000000000000000000" ? getAddress(value) : undefined;
}
export const stockAddress = configuredAddress(process.env.NEXT_PUBLIC_STOCK_TOKEN_ADDRESS || (!localMode ? deployments.contracts.stockToken : null));
export const factoryAddress = configuredAddress(process.env.NEXT_PUBLIC_FACTORY_ADDRESS || (!localMode ? deployments.contracts.factory : null));
export const deploymentReady = Boolean(stockAddress && factoryAddress);
export const publicClient = createPublicClient({ chain, transport: rateLimitedHttp(chain.rpcUrls.default.http[0]) });
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
  quoteAssets.unshift({ id: stockAddress, factory: factoryAddress, name: "Mock Stock", symbol: "MockSPYx", decimals: 18 });
}
