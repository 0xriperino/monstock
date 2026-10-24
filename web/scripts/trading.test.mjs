import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { decodeFunctionData, encodeFunctionResult, parseUnits } from 'viem';
import { factoryAbi, stockAbi, marketAbi, memeAbi, vaultAbi, launcherAbi } from '../src/lib/abis.ts';

// A local application with an isolated EIP-1193 wallet and deterministic RPC.
// Receipts are test fixtures; no transaction reaches a blockchain or user wallet.
const url = process.env.E2E_URL ?? 'http://127.0.0.1:3101';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(url).hostname));
const d = JSON.parse(await readFile(new URL('../../shared/deployments.json', import.meta.url), 'utf8'));
const { stockToken: stock, factory, market, memeToken: meme, vault } = d.contracts;
const catalog = JSON.parse(await readFile(new URL('../../shared/assets.json', import.meta.url), 'utf8'));
const quoteSymbol = catalog.assets.find(asset => asset.id.toLowerCase() === stock.toLowerCase()).symbol;
const { address: launcher } = JSON.parse(await readFile(new URL('../../shared/launcher.json', import.meta.url), 'utf8'));
const account = '0x0000000000000000000000000000000000000011';
const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_PATH ? { executablePath: process.env.BROWSER_PATH } : {}) });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
let stockAllowance = 0n, memeAllowance = 0n;
let stockBalance = parseUnits('8000', 18), memeBalance = 0n;
const quotes = [], transactions = [], receipts = new Map();
let stallQuotes = false;
const stalledReads = [];
const hash = n => `0x${n.toString(16).padStart(64, '0')}`;
const abiFor = address => address.toLowerCase() === launcher.toLowerCase() ? launcherAbi : address.toLowerCase() === factory.toLowerCase() ? factoryAbi : address.toLowerCase() === market.toLowerCase() ? marketAbi : address.toLowerCase() === vault.toLowerCase() ? vaultAbi : address.toLowerCase() === meme.toLowerCase() ? memeAbi : stockAbi;
await page.exposeFunction('__sendFixtureTransaction', tx => {
  const { functionName, args } = decodeFunctionData({ abi: abiFor(tx.to), data: tx.data });
  transactions.push(functionName);
  if (functionName === 'approve') {
    if (tx.to.toLowerCase() === stock.toLowerCase()) stockAllowance = args[1];
    else memeAllowance = args[1];
  } else if (functionName === 'buy') { stockBalance -= args[0]; memeBalance += args[0] * 2n; }
  else if (functionName === 'sell') { memeBalance -= args[0]; stockBalance += args[0] / 2n; }
  else throw new Error(`Unexpected transaction: ${functionName}`);
  const transactionHash = hash(transactions.length);
  receipts.set(transactionHash, { transactionHash, blockHash: hash(100), blockNumber: '0x64', from: account, to: tx.to, transactionIndex: '0x0', cumulativeGasUsed: '0x5208', gasUsed: '0x5208', effectiveGasPrice: '0x1', status: '0x1', type: '0x0', contractAddress: null, logs: [], logsBloom: `0x${'0'.repeat(512)}` });
  return transactionHash;
});
await page.route('https://testnet-rpc.monad.xyz/**', async route => {
  const input = route.request().postDataJSON();
  let holdResponse = false;
  const respond = item => {
    const response = { jsonrpc: '2.0', id: item.id };
    if (item.method === 'eth_chainId') return { ...response, result: '0x279f' };
    if (item.method === 'eth_getCode') return { ...response, result: '0x6000' };
    if (item.method === 'eth_blockNumber') return { ...response, result: '0x64' };
    if (item.method === 'eth_getBlockByNumber') return { ...response, result: { number: '0x64', hash: hash(100), timestamp: '0x69000000', transactions: [], baseFeePerGas: '0x1' } };
    if (item.method === 'eth_getTransactionReceipt') return { ...response, result: receipts.get(item.params[0]) ?? null };
    if (item.method === 'eth_call') {
      const { to, data } = item.params[0];
      const abi = abiFor(to);
      const { functionName, args } = decodeFunctionData({ abi, data });
      const isStock = to.toLowerCase() === stock.toLowerCase();
      if (functionName === 'quoteBuy' || functionName === 'quoteSell') {
        quotes.push({ side: functionName, amount: args[0].toString() });
        holdResponse = stallQuotes;
      }
      const values = {
        stockToken: stock, getMarkets: to.toLowerCase() === launcher.toLowerCase() ? [] : [market], memeToken: meme, vault, metadata: '',
        name: 'StockBack Demo', symbol: 'SBDEMO', decimals: 18,
        getReserves: [parseUnits('1000', 18), parseUnits('1000000', 18)],
        nextEpochAt: 9_000_000_000n, hasClaimed: true, pendingHolderRewards: 0n,
        getPositions: [], balanceOf: isStock ? stockBalance : memeBalance,
        allowance: isStock ? stockAllowance : memeAllowance,
        quoteBuy: typeof args?.[0] === 'bigint' ? args[0] * 2n : 0n,
        quoteSell: typeof args?.[0] === 'bigint' ? args[0] / 2n : 0n,
        approve: true, buy: 1n, sell: 1n,
      };
      if (!(functionName in values)) throw new Error(`Unexpected RPC function ${functionName}`);
      return { ...response, result: encodeFunctionResult({ abi, functionName, result: values[functionName] }) };
    }
    throw new Error(`Unexpected RPC method ${item.method}`);
  };
  const response = Array.isArray(input) ? input.map(respond) : respond(input);
  if (holdResponse) await new Promise(resolve => stalledReads.push(resolve));
  // A timed-out fetch may already be aborted when the old response is released.
  await route.fulfill({ json: response }).catch(error => { if (!holdResponse) throw error; });
});
await page.addInitScript(account => {
  let authorized = false;
  const listeners = new Map();
  const provider = {
    isMetaMask: true,
    on(name, fn) { const entries = listeners.get(name) ?? []; entries.push(fn); listeners.set(name, entries); return provider; },
    removeListener(name, fn) { listeners.set(name, (listeners.get(name) ?? []).filter(entry => entry !== fn)); return provider; },
    async request({ method, params = [] }) {
      if (method === 'eth_accounts') return authorized ? [account] : [];
      if (method === 'eth_requestAccounts') { authorized = true; return [account]; }
      if (method === 'eth_chainId') return '0x279f';
      if (method === 'wallet_requestPermissions') { authorized = true; return [{ parentCapability: 'eth_accounts' }]; }
      if (method === 'eth_sendTransaction') return window.__sendFixtureTransaction(params[0]);
      throw new Error(`Unexpected wallet method ${method}`);
    },
  };
  Object.defineProperty(window, 'ethereum', { value: provider });
}, account);
async function enabled(name) {
  await page.waitForFunction(label => Array.from(document.querySelectorAll('button')).some(button => button.textContent.trim() === label && !button.disabled), name, { timeout: 30_000 });
  return page.getByRole('button', { name, exact: true }).last();
}
async function confirm(button) {
  const previous = await page.locator('.sb-transaction .sb-hash').textContent().catch(() => '');
  await button.click();
  await page.waitForFunction(previous => {
    const current = document.querySelector('.sb-transaction--success .sb-hash')?.textContent;
    return current && current !== previous;
  }, previous, { timeout: 30_000 });
}
try {
  await page.goto(url);
  await page.locator('.sb-topbar').getByRole('button', { name: 'Connect wallet', exact: true }).click();
  await page.getByRole('button', { name: 'Trade SBDEMO', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Trade SBDEMO', exact: true }).click();
  const input = page.getByLabel('You pay', { exact: true });
  await page.waitForFunction(() => { const input = document.querySelector('input[autocomplete="off"]'); return input && !input.disabled; });
  await input.pressSequentially('3000', { delay: 40 });
  await page.getByText('Estimate ready', { exact: true }).waitFor({ timeout: 30_000 });
  assert.deepEqual(quotes, [{ side: 'quoteBuy', amount: parseUnits('3000', 18).toString() }], 'Typing an amount must request only its final quote, not one RPC run per character.');
  assert.equal(await page.getByRole('button', { name: 'Buy SBDEMO', exact: true }).last().isDisabled(), true);
  console.log('PASS: typing is debounced; a quote is shown; trading waits for approval.');
  await confirm(await enabled(`Approve ${quoteSymbol}`));
  await confirm(await enabled('Buy SBDEMO'));
  console.log('PASS: approval automatically refreshes the quote; buy needs no manual Refresh.');
  await page.getByRole('button', { name: 'Sell SBDEMO', exact: true }).first().click();
  await input.fill('100');
  await confirm(await enabled('Approve SBDEMO'));
  await confirm(await enabled('Sell SBDEMO'));
  assert.deepEqual(transactions, ['approve', 'buy', 'approve', 'sell']);
  console.log('PASS: selling uses its own approval and refreshed quote; no browser errors.');
  stallQuotes = true;
  await input.fill('200');
  await page.getByText('Estimate timed out. Refresh the estimate to retry.', { exact: true }).waitFor({ timeout: 30_000 });
  assert.equal(await page.getByRole('button', { name: 'Sell SBDEMO', exact: true }).last().isDisabled(), true);
  stallQuotes = false;
  await page.getByRole('button', { name: 'Refresh trade estimate', exact: true }).click();
  await page.getByText('Estimate ready', { exact: true }).waitFor({ timeout: 30_000 });
  stalledReads.splice(0).forEach(release => release());
  await page.waitForTimeout(250);
  assert.equal(await page.getByText('Estimate ready', { exact: true }).isVisible(), true);
  assert.deepEqual(errors, []);
  console.log('PASS: stalled estimates time out, manual retry recovers, and late responses do not replace the new quote.');
  console.log('All swap regressions passed with isolated wallet/RPC/receipt fixtures. No real transactions submitted.');
} catch (error) {
  console.error('Trading UI:', (await page.locator('body').innerText()).slice(-6000));
  throw error;
} finally { stalledReads.splice(0).forEach(release => release()); await browser.close(); }
