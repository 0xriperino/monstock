import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import { createPublicClient, defineChain, getAddress, isAddress } from "viem";
import deployments from "../../../shared/deployments.json";

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
export const publicClient = createPublicClient({ chain, transport: http(chain.rpcUrls.default.http[0], { batch: true }) });
export const wagmiConfig = createConfig({ chains: [chain], connectors: [injected()], transports: { [chain.id]: http(chain.rpcUrls.default.http[0]) }, ssr: true });
