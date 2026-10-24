import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../web/package.json', import.meta.url));
const { createPublicClient, http } = require('viem');
const root = new URL('../../', import.meta.url);
const file = process.argv[2];
if (!file) throw new Error('Usage: node contracts/script/export-deployment.mjs broadcast/Deploy.s.sol/10143/run-latest.json');
const run = JSON.parse(await readFile(file, 'utf8'));
const rpc = process.env.MONAD_RPC_URL ?? 'https://testnet-rpc.monad.xyz';
const client = createPublicClient({ transport: http(rpc) });
const chainId = await client.getChainId();
if (chainId !== 10143) throw new Error('Only Monad Testnet deployment records may be exported here.');
const artifacts = async name => JSON.parse(await readFile(new URL(`contracts/out/${name}.sol/${name}.json`, root), 'utf8')).abi;
const transactions = [];
for (const tx of run.transactions) {
  const receipt = await client.getTransactionReceipt({ hash: tx.hash });
  if (receipt.status !== 'success') throw new Error(`Unsuccessful transaction: ${tx.hash}`);
  transactions.push({ hash: receipt.transactionHash, blockNumber: receipt.blockNumber.toString(), explorerUrl: `https://testnet.monadscan.com/tx/${receipt.transactionHash}` });
}
const stockToken = run.transactions.find(tx => tx.contractName === 'MockStock' && tx.transactionType === 'CREATE')?.contractAddress;
const factory = run.transactions.find(tx => tx.contractName === 'StockBackFactory' && tx.transactionType === 'CREATE')?.contractAddress;
if (!stockToken || !factory) throw new Error('Deployment receipts do not contain the required deployments.');
const markets = await client.readContract({ address: factory, abi: await artifacts('StockBackFactory'), functionName: 'getMarkets' });
const market = markets[0];
if (!market) throw new Error('No confirmed demo market.');
const memeToken = await client.readContract({ address: market, abi: await artifacts('MemeMarket'), functionName: 'memeToken' });
const vault = await client.readContract({ address: market, abi: await artifacts('MemeMarket'), functionName: 'vault' });
for (const address of [stockToken, factory, memeToken, market, vault]) {
  if (!await client.getCode({ address })) throw new Error(`No deployed code at ${address}`);
}
await writeFile(new URL('shared/deployments.json', root), JSON.stringify({ chainId, network: 'Monad Testnet', rpcUrl: rpc, status: 'deployed', contracts: { stockToken, factory, memeToken, market, vault }, transactions }, null, 2) + '\n');
console.log('Saved verified Monad Testnet addresses and receipt hashes.');
