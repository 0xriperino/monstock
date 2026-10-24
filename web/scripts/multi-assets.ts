import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createPublicClient, createWalletClient, createTestClient, defineChain, encodeDeployData, formatEther, http, parseEther, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { StockBackClient, type QuoteAssetConfig } from "../src/lib/stockback";
import { stockAbi } from "../src/lib/abis";
import { rateLimitedHttp } from "../src/lib/rpc";

const live = process.argv.includes("--testnet");
const rpc = live ? "https://testnet-rpc.monad.xyz" : "http://127.0.0.1:8546";
const chain = defineChain({ id: live ? 10143 : 31337, name: live ? "Monad Testnet" : "Local", nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 }, rpcUrls: { default: { http: [rpc] } }, testnet: true });
const client = createPublicClient({ chain, pollingInterval: live ? 1000 : 50, transport: live ? rateLimitedHttp(rpc) : http(rpc) });
assert.equal(await client.getChainId(), chain.id);
const account = live ? privateKeyToAccount(process.env.DEPLOYER_PRIVATE_KEY as Hex) : (await createWalletClient({ transport: http(rpc) }).getAddresses())[0];
const wallet = createWalletClient({ account, chain, transport: live ? rateLimitedHttp(rpc) : http(rpc) });
const address = typeof account === "string" ? account : account.address;
if (live) assert.equal(address.toLowerCase(), "0x7640dfae2c612aba5567477aaa91b181f6de1a7c".toLowerCase());
const root = new URL("../../", import.meta.url);
const catalog = JSON.parse(await readFile(new URL("shared/assets.json", root), "utf8")) as { chainId: number; assets: QuoteAssetConfig[] };
if (!live) { catalog.chainId = chain.id; catalog.assets = []; }
const receiptPath = new URL(live ? "shared/asset-deployments.json" : "shared/asset-local.json", root);
const records: { label: string; hash: Hex; address?: Address }[] = live ? await readFile(receiptPath, "utf8").then(JSON.parse).catch(() => []) : [];
const save = async () => {
  await writeFile(receiptPath, JSON.stringify(records, null, 2) + "\n");
  if (live) await writeFile(new URL("shared/assets.json", root), JSON.stringify(catalog, null, 2) + "\n");
};
async function artifact(name: string) { return JSON.parse(await readFile(new URL(`contracts/out/${name}.sol/${name}.json`, root), "utf8")); }
async function confirm(label: string, hash: Hex) {
  const receipt = await client.waitForTransactionReceipt({ hash });
  assert.equal(receipt.status, "success");
  records.push({ label, hash, ...(receipt.contractAddress ? { address: receipt.contractAddress } : {}) });
  await save();
  console.log(label, receipt.contractAddress ?? hash);
  return receipt;
}
async function deploy(name: string, label: string, args: readonly unknown[]) {
  const previous = records.find(r => r.label === label)?.address;
  if (previous) { assert.ok(await client.getCode({ address: previous })); return previous; }
  const a = await artifact(name);
  const gasPrice = await client.getGasPrice();
  const gas = await client.estimateGas({ account: address, data: encodeDeployData({ abi: a.abi, bytecode: a.bytecode.object, args }) });
  assert.ok(await client.getBalance({ address }) > gas * gasPrice * 12n / 10n, "Insufficient test MON for deployment.");
  const receipt = await confirm(label, await wallet.deployContract({ abi: a.abi, bytecode: a.bytecode.object, args }));
  assert.ok(receipt.contractAddress);
  return receipt.contractAddress;
}
const specs = [
  { name: "Mock PYDX", symbol: "PYDX" },
  { name: "Mock NVIDIA", symbol: "NVDAX" },
  { name: "Mock Gold", symbol: "GLDX" },
  { name: "Mock Anthropic", symbol: "ANTHROPIC" },
];
// Preflight all remaining creations with a margin before spending any test MON.
if (live) {
  let estimate = 0n;
  for (const spec of specs) {
    if (catalog.assets.some(a => a.symbol === spec.symbol)) continue;
    for (const [name, args] of [["MockQuoteAsset", [spec.name, spec.symbol]], ["StockBackFactory", [catalog.assets[0].id, address]]] as const) {
      const a = await artifact(name);
      estimate += await client.estimateGas({ account: address, data: encodeDeployData({ abi: a.abi, bytecode: a.bytecode.object, args }) });
    }
  }
  const budget = (estimate + 6_000_000n) * (await client.getGasPrice()) * 12n / 10n;
  console.log("Deployment budget incl. demo and margin MON:", formatEther(budget));
  assert.ok(await client.getBalance({ address }) > budget, "Additional test MON is needed before deployment.");
}
for (const spec of specs) {
  if (catalog.assets.some(a => a.symbol === spec.symbol)) continue;
  const id = await deploy("MockQuoteAsset", `Deploy ${spec.symbol}`, [spec.name, spec.symbol]);
  const factory = await deploy("StockBackFactory", `Factory ${spec.symbol}`, [id, address]);
  catalog.assets.push({ ...spec, id, factory, decimals: 18 });
  await save();
}
const service = (asset: QuoteAssetConfig) => new StockBackClient(client, chain, asset.id, asset.factory, async () => wallet, undefined, catalog.assets);
for (const asset of catalog.assets.filter(a => !live || a.symbol === "NVDAX")) {
  const c = service(asset);
  await c.assertDeployment();
  const claimed = await client.readContract({ address: asset.id, abi: stockAbi, functionName: "hasClaimed", args: [address] });
  if (!claimed) await confirm(`Faucet ${asset.symbol}`, (await c.faucet()).transactionHash);
  const ownPools = (await c.pools()).filter(p => p.stock.toLowerCase() === asset.id.toLowerCase());
  if (!ownPools.length) await confirm(`Demo pair ${asset.symbol}`, (await c.createCoin(`${asset.symbol} Meme`, asset.symbol === "NVDAX" ? "NVME" : `M${asset.symbol}`.slice(0, 12), "1000")).transactionHash);
  if (!live) {
    const pool = (await c.pools()).find(p => p.stock.toLowerCase() === asset.id.toLowerCase())!;
    await c.approve(asset.id, pool.market, "100");
    const request = { marketId: pool.market, side: "buy" as const, amount: "100", slippageBps: 50 };
    const q = await c.quote(request);
    await c.trade({ ...request, quoteId: q.id, minimumOutput: q.minimumOutput! });
    await c.approve(asset.id, pool.vault, "10");
    await c.deposit(pool.market, "10", 30);
    const snap = await c.snapshot(address);
    assert.equal(snap.stockToken.symbol, asset.symbol);
    assert.equal(snap.markets.filter(m => m.stockToken?.id.toLowerCase() === asset.id.toLowerCase()).length, 1);
    assert.equal(snap.markets.length, (await c.pools()).length);
    assert.equal(snap.wallet.stockBalance, "8890");
    assert.equal(snap.vault.totalLockedPrincipal, "10");
    assert.equal(snap.vault.positions.length, 1);
    assert.equal(snap.wallet.faucetAvailable, false);
    for (const other of catalog.assets.filter(a => a.id !== asset.id)) {
      assert.equal(await client.readContract({ address: other.id, abi: stockAbi, functionName: "balanceOf", args: [pool.market] }), 0n);
    }
  }
}
if (!live) {
  const test = createTestClient({ chain, mode: "anvil", transport: http(rpc) });
  await test.increaseTime({ seconds: 301 }); await test.mine({ blocks: 1 });
  for (const asset of catalog.assets) {
    const c = service(asset); const snap = await c.snapshot(address);
    await c.settle(snap.selectedMarketId!);
    const settled = await c.snapshot(address);
    assert.equal(settled.vault.earnedRewards, "0.1");
    assert.ok(parseEther(settled.portfolio.claimableHolderRewards!) > 0n);
    await c.claim(snap.selectedMarketId!);
  }
  await writeFile(new URL("shared/asset-local.json", root), JSON.stringify(catalog, null, 2));
  const c = service(catalog.assets[1]);
  const snap = await c.snapshot(address);
  const pool = (await c.pools()).find(p => p.market === snap.selectedMarketId)!;
  const other = catalog.assets[0];
  const otherBefore = await client.readContract({ address: other.id, abi: stockAbi, functionName: "balanceOf", args: [address] });
  await c.approve(pool.meme, pool.market, "10");
  const request = { marketId: pool.market, side: "sell" as const, amount: "10", slippageBps: 50 };
  const q = await c.quote(request);
  await c.trade({ ...request, quoteId: q.id, minimumOutput: q.minimumOutput! });
  assert.equal(await client.readContract({ address: other.id, abi: stockAbi, functionName: "balanceOf", args: [address] }), otherBefore);
  console.log("PASS: four assets, creation, buy, deposit, isolated balances/totals, fee settlement and claims.");
}
console.log("Remaining native balance", formatEther(await client.getBalance({ address })));
