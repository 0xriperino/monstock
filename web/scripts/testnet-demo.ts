import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { BaseError, createPublicClient, createWalletClient, defineChain, formatEther, formatUnits, http, parseUnits, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { marketAbi, stockAbi, vaultAbi } from "../src/lib/abis";
import { StockBackClient, errorMessage } from "../src/lib/stockback";
import { rateLimitedHttp } from "../src/lib/rpc";

// This script spends TEST MON for real Monad Testnet transactions only.
// Never import it into the frontend or copy its signing environment to hosting.
async function main() {
  if (process.env.ALLOW_TESTNET_TRANSACTIONS !== "true") throw new Error("Set ALLOW_TESTNET_TRANSACTIONS=true to run this funded testnet demo.");
  const root = new URL("../../", import.meta.url);
  const deployment = JSON.parse(await readFile(new URL("shared/deployments.json", root), "utf8"));
  if (deployment.chainId !== 10143 || deployment.status !== "deployed") throw new Error("Verified Monad Testnet deployment required.");
  const key = process.env.DEPLOYER_PRIVATE_KEY as Hex | undefined;
  if (!key) throw new Error("Local deployment credential is missing.");
  const chain = defineChain({ id: 10143, name: "Monad Testnet", nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 }, rpcUrls: { default: { http: [process.env.MONAD_RPC_URL ?? deployment.rpcUrl] } }, testnet: true });
  const client = createPublicClient({ chain, transport: rateLimitedHttp(chain.rpcUrls.default.http[0]), pollingInterval: 1600 });
  assert.equal(await client.getChainId(), 10143);
  const account = privateKeyToAccount(key);
  const wallet = createWalletClient({ account, chain, transport: rateLimitedHttp(chain.rpcUrls.default.http[0]) });
  const addresses = deployment.contracts;
  const service = new StockBackClient(client, chain, addresses.stockToken, addresses.factory, async () => wallet, (label, hash) => { if (hash) console.log(`${label}: ${hash}`); });
  const receipts: { label: string; hash: Hex; blockNumber: string; explorerUrl: string }[] = [];
  const reportPath = new URL("shared/testnet-e2e.json", root);
  const startedBalance = await client.getBalance({ address: account.address });
  const report = { chainId: 10143, network: "Monad Testnet", account: account.address, status: "running", transactions: receipts, checks: [] as string[], gasSpentMon: "" };
  async function save() { await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n"); }
  async function record(label: string, operation: () => ReturnType<StockBackClient["claim"]>) {
    const receipt = await operation();
    assert.equal(receipt.status, "success");
    receipts.push({ label, hash: receipt.transactionHash, blockNumber: receipt.blockNumber.toString(), explorerUrl: `https://testnet.monadscan.com/tx/${receipt.transactionHash}` });
    await save();
    // Keep only one in-flight transaction on a small-balance Monad deployer.
    await new Promise(resolve => setTimeout(resolve, 1600));
    return receipt;
  }
  await service.assertDeployment();
  const pool = await service.pool(addresses.market);
  const beforePositions = await client.readContract({ address: pool.vault, abi: vaultAbi, functionName: "getPositions", args: [account.address] });
  const beforeStock = await client.readContract({ address: addresses.stockToken, abi: stockAbi, functionName: "balanceOf", args: [account.address] });
  assert.ok(beforeStock >= parseUnits("150", 18), "Need test MockSPYx for this demo.");
  await assert.rejects(() => service.faucet(), /already claimed/);
  report.checks.push("Deployed code, Factory/Market/Vault relationships, faucet single-claim limit");
  await record("Approve buy", () => service.approve(addresses.stockToken, pool.market, "100"));
  const buyRequest = { marketId: pool.market, side: "buy" as const, amount: "100", slippageBps: 50 };
  const buyQuote = await service.quote(buyRequest);
  await record("Buy meme tokens", () => service.trade({ ...buyRequest, quoteId: buyQuote.id, minimumOutput: buyQuote.minimumOutput! }));
  const state = await service.snapshot(account.address, pool.market);
  const sellAmount = formatUnits(parseUnits(state.markets.find(m => m.id.toLowerCase() === pool.market.toLowerCase())!.walletBalance!, 18) / 2n, 18);
  await record("Approve sell", () => service.approve(pool.meme, pool.market, sellAmount));
  const sellRequest = { ...buyRequest, side: "sell" as const, amount: sellAmount };
  const sellQuote = await service.quote(sellRequest);
  await record("Sell partial balance", () => service.trade({ ...sellRequest, quoteId: sellQuote.id, minimumOutput: sellQuote.minimumOutput! }));
  report.checks.push("Exact buy/sell quotes, approvals, actual AMM swaps and confirmed receipts");
  const at = await client.readContract({ address: pool.market, abi: marketAbi, functionName: "nextEpochAt" });
  while (true) {
    const block = await client.getBlock();
    if (block.timestamp >= at) break;
    const remaining = Number(at - block.timestamp);
    console.log(`Waiting for real testnet epoch: ${remaining}s (no time manipulation).`);
    await new Promise(resolve => setTimeout(resolve, Math.min(remaining, 20) * 1000));
  }
  await record("Permissionless epoch settlement", () => service.settle(pool.market));
  const reward = await client.readContract({ address: pool.market, abi: marketAbi, functionName: "pendingHolderRewards", args: [account.address] });
  assert.ok(reward > 0n);
  await record("Claim MockSPYx holder rewards", () => service.claim(pool.market));
  await assert.rejects(() => service.claim(pool.market), /No holder rewards/);
  report.checks.push("Real 300-second settlement, readable holder reward, claim and no double claim");
  await record("Approve two Vault deposits", () => service.approve(addresses.stockToken, pool.vault, formatUnits(reward + parseUnits("25", 18), 18)));
  await record("Deposit claimed rewards for 30 days", () => service.deposit(pool.market, formatUnits(reward, 18), 30));
  await record("Deposit wallet stock for 90 days", () => service.deposit(pool.market, "25", 90));
  const positions = await client.readContract({ address: pool.vault, abi: vaultAbi, functionName: "getPositions", args: [account.address] });
  assert.equal(positions.length, beforePositions.length + 2);
  const added = positions.slice(beforePositions.length);
  assert.equal(added[0].amount, reward);
  assert.equal(added[0].unlockAt - added[0].startAt, 30n * 86400n);
  assert.equal(added[1].unlockAt - added[1].startAt, 90n * 86400n);
  await assert.rejects(() => service.withdraw(`${pool.vault}:${added[0].id}`), /still locked/);
  await assert.rejects(() => client.simulateContract({ address: pool.vault, abi: vaultAbi, functionName: "withdraw", args: [added[0].id], account }));
  report.checks.push("Both deposit sources, two real locked positions, exact unlock times, early withdrawal rejected by client and contract");
  report.status = "passed";
  report.gasSpentMon = formatEther(startedBalance - await client.getBalance({ address: account.address }));
  await save();
  console.log(JSON.stringify({ status: report.status, chainId: 10143, transactions: receipts.length, gasSpentMon: report.gasSpentMon, positions: added.map(p => ({ id: p.id.toString(), principal: formatUnits(p.amount, 18), unlockAt: p.unlockAt.toString() })) }, null, 2));
}
main().catch(error => { console.error(errorMessage(error)); if (error instanceof BaseError) console.error(error.details); process.exitCode = 1; });
