import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createPublicClient, createTestClient, createWalletClient, defineChain, formatUnits, http, parseUnits, type Address, type Hex } from "viem";
import { factoryAbi, marketAbi, stockAbi, vaultAbi } from "../src/lib/abis";
import { StockBackClient } from "../src/lib/stockback";

// REAL transactions on local Anvil only. No private key is loaded, stored, or logged.
const root = new URL("../../", import.meta.url);
const rpcUrl = process.env.LOCAL_RPC_URL ?? "http://127.0.0.1:8545";
if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(rpcUrl).hostname)) throw new Error("Local demo refuses non-loopback RPC URLs.");
const chain = defineChain({ id: 31337, name: "StockBack Local (Anvil)", nativeCurrency: { name: "Test Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [rpcUrl] } }, testnet: true });
const client = createPublicClient({ chain, transport: http(rpcUrl) });
assert.equal(await client.getChainId(), 31337, "Local demo refuses testnet/mainnet.");
const test = createTestClient({ chain, mode: "anvil", transport: http(rpcUrl) });
const checkpoint = await test.snapshot();
const accounts = await createWalletClient({ chain, transport: http(rpcUrl) }).getAddresses();
assert.ok(accounts.length >= 3, "Start Anvil with at least 3 unlocked development accounts.");
const [creator, trader, treasury] = accounts;
const wallet = (account: Address) => createWalletClient({ account, chain, transport: http(rpcUrl) });
const receipts: { label: string; hash: Hex; blockNumber: string }[] = [];
async function confirm(label: string, hash: Hex) {
  const receipt = await client.waitForTransactionReceipt({ hash });
  assert.equal(receipt.status, "success");
  receipts.push({ label, hash, blockNumber: receipt.blockNumber.toString() });
  return receipt;
}
async function deploy(name: string, args: readonly unknown[] = []) {
  const artifact = JSON.parse(await readFile(new URL(`contracts/out/${name}.sol/${name}.json`, root), "utf8"));
  const receipt = await confirm(`Deploy ${name}`, await wallet(creator).deployContract({ abi: artifact.abi, bytecode: artifact.bytecode.object as Hex, args }));
  assert.ok(receipt.contractAddress);
  return receipt.contractAddress;
}
const stock = await deploy("MockStock");
const factory = await deploy("StockBackFactory", [stock, treasury]);
const pending: { label: string; hash?: Hex }[] = [];
const service = (account: Address) => new StockBackClient(client, chain, stock, factory, async () => wallet(account), (label, hash) => pending.push({ label, hash }));
const alice = service(creator);
const bob = service(trader);
async function record(label: string, operation: () => ReturnType<StockBackClient["faucet"]>) {
  const receipt = await operation();
  assert.equal(receipt.status, "success");
  receipts.push({ label, hash: receipt.transactionHash, blockNumber: receipt.blockNumber.toString() });
  return receipt;
}
assert.equal((await alice.snapshot()).markets.length, 0);
await record("Creator faucet", () => alice.faucet());
await assert.rejects(() => alice.faucet(), /already claimed/);
await record("Create demo coin (with real initial approval)", () => alice.createCoin("StockBack Demo", "SBDEMO", "1000"));
const pool = (await alice.pools())[0];
assert.ok(pool);
assert.equal((await alice.snapshot(creator, pool.market)).markets.length, 1);
await record("Approve creator vault", () => alice.approve(stock, pool.vault, "100"));
await record("Create active reward weight", () => alice.deposit(pool.market, "100", 90));
await record("Trader faucet", () => bob.faucet());
const request = { marketId: pool.market, side: "buy" as const, amount: "100", slippageBps: 50 };
let quote = await bob.quote(request);
assert.equal(quote.feeAmount, "1");
await assert.rejects(() => bob.trade({ ...request, quoteId: quote.id, minimumOutput: quote.minimumOutput! }), /Approve/);
await record("Approve buy", () => bob.approve(stock, pool.market, "100"));
quote = await bob.quote(request);
await assert.rejects(() => bob.trade({ ...request, quoteId: quote.id, minimumOutput: "1" }), /Quote changed/);
await record("Buy", () => bob.trade({ ...request, quoteId: quote.id, minimumOutput: quote.minimumOutput! }));
await assert.rejects(() => bob.trade({ ...request, quoteId: quote.id, minimumOutput: quote.minimumOutput! }), /Quote changed/);
const held = parseUnits((await bob.snapshot(trader, pool.market)).markets[0].walletBalance!, 18);
const sellAmount = formatUnits(held / 2n, 18);
await record("Approve sell", () => bob.approve(pool.meme, pool.market, sellAmount));
const sellRequest = { ...request, side: "sell" as const, amount: sellAmount };
const sellQuote = await bob.quote(sellRequest);
const beforeSell = await client.readContract({ address: stock, abi: stockAbi, functionName: "balanceOf", args: [trader] });
await record("Sell", () => bob.trade({ ...sellRequest, quoteId: sellQuote.id, minimumOutput: sellQuote.minimumOutput! }));
const afterSell = await client.readContract({ address: stock, abi: stockAbi, functionName: "balanceOf", args: [trader] });
assert.equal(afterSell - beforeSell, parseUnits(sellQuote.outputAmount!, 18));
await assert.rejects(() => bob.settle(pool.market), /not ready/);
await test.increaseTime({ seconds: 301 });
await test.mine({ blocks: 1 });
await record("Permissionless settlement", () => bob.settle(pool.market));
const rewards = await client.readContract({ address: pool.market, abi: marketAbi, functionName: "pendingHolderRewards", args: [trader] });
assert.ok(rewards > 0n);
assert.ok(await client.readContract({ address: pool.vault, abi: vaultAbi, functionName: "rewardReserve" }) > 0n);
await record("Claim holder rewards", () => bob.claim(pool.market));
await assert.rejects(() => bob.claim(pool.market), /No holder rewards/);
await record("Approve both trader deposits", () => bob.approve(stock, pool.vault, formatUnits(rewards + parseUnits("50", 18), 18)));
await record("Deposit claimed rewards", () => bob.deposit(pool.market, formatUnits(rewards, 18), 30));
await record("Deposit wallet tokens", () => bob.deposit(pool.market, "50", 90));
const snapshot = await bob.snapshot(trader, pool.market);
assert.equal(snapshot.vault.positions.length, 2);
assert.ok(snapshot.vault.positions.every(p => !p.canWithdraw));
await assert.rejects(() => bob.withdraw(snapshot.vault.positions[0].id), /still locked/);
const short = snapshot.vault.positions.find(p => p.lockDays === 30)!;
const id = BigInt(short.id.split(":")[1]);
await assert.rejects(() => client.simulateContract({ address: pool.vault, abi: vaultAbi, functionName: "withdraw", args: [id], account: trader }));
await test.increaseTime({ seconds: 30 * 86400 + 1 });
await test.mine({ blocks: 1 });
await record("Withdraw after local time advancement", () => bob.withdraw(short.id));
assert.equal((await bob.snapshot(trader, pool.market)).vault.positions.length, 1);
assert.ok(pending.some(p => p.hash), "Pending states must include actual submitted transaction hashes.");
const testedTransactions = receipts.length;
await writeFile(new URL("shared/local-e2e-report.json", root), JSON.stringify({ network: "LOCAL ANVIL ONLY", successfulTestTransactions: testedTransactions, testStateRevertedAfterSuccess: true, checks: ["real deployment", "single-claim faucet", "auto initial approval", "createCoin", "missing allowance rejection", "buy", "sell", "quote minimum tamper rejection", "quote reuse rejection", "300-second epoch", "real vault reward funding", "claim/no double claim", "claimed reward deposit", "wallet token deposit", "two locked positions", "early withdrawal rejected by client AND contract", "withdrawal after local time advance", "snapshot refresh", "actual transaction hashes"] }, null, 2) + "\n");
// Restore the test clock and state before creating the user-facing local demo.
// The 30-day unlock test must not leave the demo's countdown 30 days ahead of the browser.
await test.revert({ id: checkpoint });
receipts.length = 0;
const demoStock = await deploy("MockStock");
const demoFactory = await deploy("StockBackFactory", [demoStock, treasury]);
const demo = new StockBackClient(client, chain, demoStock, demoFactory, async () => wallet(creator));
await record("Demo creator faucet", () => demo.faucet());
await record("Demo initial market", () => demo.createCoin("StockBack Demo", "SBDEMO", "1000"));
const demoPool = (await demo.pools())[0];
const contracts = { stockToken: demoStock, factory: demoFactory, memeToken: demoPool.meme, market: demoPool.market, vault: demoPool.vault };
await writeFile(new URL("shared/deployments.local.json", root), JSON.stringify({ chainId: 31337, network: chain.name, status: "deployed_locally", rpcUrl, contracts, accounts: { creator, trader, treasury }, transactions: receipts }, null, 2) + "\n");
await writeFile(new URL("web/.env.local", root), `NEXT_PUBLIC_USE_ANVIL=true\nNEXT_PUBLIC_RPC_URL=${rpcUrl}\nNEXT_PUBLIC_STOCK_TOKEN_ADDRESS=${demoStock}\nNEXT_PUBLIC_FACTORY_ADDRESS=${demoFactory}\n`);
// Empty local blocks keep chain-time eligibility current while users wait for an epoch.
// This mines blocks only; settlement still requires a user's transaction.
await test.setIntervalMining({ interval: 1 });
console.log(JSON.stringify({ network: "LOCAL ANVIL ONLY", chainId: 31337, contracts, successfulTestTransactions: testedTransactions, demoTransactions: receipts.length, checks: "ALL PASSED", publicEnvFile: "web/.env.local (ignored)" }, null, 2));
