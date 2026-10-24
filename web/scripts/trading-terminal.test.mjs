import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { decodeFunctionData, encodeAbiParameters, encodeEventTopics, encodeFunctionResult, parseAbiItem, parseEther, toHex, zeroAddress } from 'viem';
import { factoryAbi, marketAbi, memeAbi, stockAbi, vaultAbi, launcherAbi } from '../src/lib/abis.ts';
import { respondToMulticall } from './multicall-fixture.mjs';

// Browser-only RPC fixtures. No wallet signs or broadcasts a transaction.
const url = process.env.E2E_URL ?? 'http://127.0.0.1:3111';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(url).hostname));
const deployment = JSON.parse(await readFile(new URL('../../shared/deployments.json', import.meta.url), 'utf8'));
const registry = JSON.parse(await readFile(new URL('../../shared/assets.json', import.meta.url), 'utf8'));
const abi = [...factoryAbi, ...marketAbi, ...memeAbi, ...stockAbi, ...vaultAbi, ...launcherAbi];
const asset = registry.assets[0];
const token = '0x0000000000000000000000000000000000000011';
const market = '0x0000000000000000000000000000000000000022';
const vault = '0x0000000000000000000000000000000000000033';
const alice = '0x0000000000000000000000000000000000000044';
const bob = '0x0000000000000000000000000000000000000055';
const base = BigInt(deployment.transactions[0].blockNumber);
const created = base + 10n;
const epoch = Math.floor(Date.now() / 1000) - 3600;
const transferEvent = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)');
const swapEvent = parseAbiItem('event Swap(address indexed trader, bool isBuy, uint256 amountIn, uint256 amountOut, uint256 stockFee)');
let updated = false;
let failHistory = false;
function eventLog(address, block, event, args) {
  const dataInputs = event.inputs.filter(input => !input.indexed);
  return { address, blockNumber: toHex(base + BigInt(block)), blockHash: `0x${'1'.repeat(64)}`, transactionHash: `0x${block.toString(16).padStart(64, '0')}`, transactionIndex: '0x0', logIndex: '0x0', removed: false,
    topics: encodeEventTopics({ abi: [event], eventName: event.name, args }), data: encodeAbiParameters(dataInputs, dataInputs.map(input => args[input.name])) };
}
function history() {
  const transfers = [[10, zeroAddress, market, '1000000'], [20, market, alice, '100'], [30, market, bob, '200'], [35, alice, bob, '20']];
  const swaps = [[20, alice, true, '10', '100', '.1'], [30, bob, true, '20', '200', '.2']];
  if (updated) { transfers.push([70, bob, market, '100']); swaps.push([70, bob, false, '100', '10', '.1']); }
  return [...transfers.map(([block, from, to, value]) => eventLog(token, block, transferEvent, { from, to, value: parseEther(value) })), ...swaps.map(([block, trader, isBuy, amountIn, amountOut, stockFee]) => eventLog(market, block, swapEvent, { trader, isBuy, amountIn: parseEther(amountIn), amountOut: parseEther(amountOut), stockFee: parseEther(stockFee) }))];
}
const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_PATH ? { executablePath: process.env.BROWSER_PATH } : process.platform === 'win32' ? { executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' } : {}) });
try {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1100 }, permissions: ['clipboard-read', 'clipboard-write'] });
  await context.route(/^https:\/\/(?:testnet-rpc\.monad\.xyz|monad-testnet\.drpc\.org)(?:\/|$)/, async route => {
    const body = route.request().postDataJSON();
    const respond = request => {
      const multicall = respondToMulticall(request, respond);
      if (multicall) return multicall;
      const reply = { jsonrpc: '2.0', id: request.id };
      const head = base + (updated ? 80n : 60n);
      if (request.method === 'eth_chainId') return { ...reply, result: '0x279f' };
      if (request.method === 'eth_blockNumber') return { ...reply, result: toHex(head) };
      if (request.method === 'eth_getCode') return { ...reply, result: request.params[0].toLowerCase() === token && request.params[1] !== 'latest' && BigInt(request.params[1]) < created ? '0x' : '0x6000' };
      if (request.method === 'eth_getBlockByNumber') {
        const height = request.params[0] === 'latest' ? head : BigInt(request.params[0]);
        return { ...reply, result: { number: toHex(height), hash: `0x${'1'.repeat(64)}`, timestamp: toHex(BigInt(epoch) + (height - base) * 30n), transactions: [] } };
      }
      if (request.method === 'eth_getLogs') {
        if (failHistory) return { ...reply, error: { code: -32000, message: 'History fixture temporarily unavailable' } };
        const filter = request.params[0];
        return { ...reply, result: history().filter(log => BigInt(log.blockNumber) >= BigInt(filter.fromBlock) && BigInt(log.blockNumber) <= BigInt(filter.toBlock)) };
      }
      if (request.method === 'eth_call') {
        const { functionName, args } = decodeFunctionData({ abi, data: request.params[0].data });
        const target = request.params[0].to.toLowerCase();
        const values = { stockToken: asset.id, getMarkets: target === asset.factory.toLowerCase() ? [market] : [], memeToken: token, vault, tradingFeeBps: 100n, name: 'Terminal Test', symbol: 'TERM', getReserves: [parseEther('1000'), parseEther('1000000')], nextEpochAt: BigInt(epoch + 7200), metadata: '', quoteBuy: parseEther('100'), quoteSell: parseEther('1') };
        if (!(functionName in values)) throw new Error(`Unexpected fixture read: ${functionName} ${args}`);
        return { ...reply, result: encodeFunctionResult({ abi, functionName, result: values[functionName] }) };
      }
      throw new Error(`Unexpected fixture RPC: ${request.method}`);
    };
    await route.fulfill({ json: Array.isArray(body) ? body.map(respond) : respond(body) });
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.setDefaultTimeout(45_000);
  await page.goto(url);
  await page.getByRole('button', { name: 'Trade TERM', exact: true }).click();
  assert.equal(await page.getByText('Loading markets…', { exact: true }).count(), 0);
  await page.locator('.sb-lightweight-chart canvas').first().waitFor();
  await page.getByRole('heading', { name: 'Top holders', exact: true }).waitFor();
  assert.equal(await page.locator('.sb-holders-panel').first().locator('tbody tr').count(), 2);
  assert.match(await page.locator('.sb-holders-panel').first().locator('tbody tr').first().innerText(), /220/);
  await page.getByRole('button', { name: '5m', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: '5m', exact: true }).getAttribute('aria-pressed'), 'true');
  await page.getByRole('button', { name: 'Fit chart', exact: true }).click();
  await page.getByRole('button', { name: 'Copy token contract address' }).click();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), token);
  const quotePayment = page.getByRole('button', { name: `Pay with ${asset.symbol}`, exact: true });
  if (await quotePayment.count()) await quotePayment.click();
  await page.getByLabel('You pay', { exact: true }).fill('1');
  await page.getByText('Estimate ready', { exact: true }).waitFor();
  updated = true;
  await page.getByRole('button', { name: 'Refresh market activity' }).click();
  await page.waitForFunction(() => document.querySelectorAll('.sb-holders-panel')[1]?.querySelectorAll('tbody tr').length === 3);
  assert.match(await page.locator('.sb-holders-panel').first().locator('tbody tr').first().innerText(), /120/);
  const chart = page.locator('.sb-lightweight-chart');
  await chart.hover({ position: { x: 100, y: 100 } });
  await page.mouse.wheel(-200, 0);
  await page.getByRole('button', { name: 'Live', exact: true }).click();
  for (const width of [1600, 1100, 850, 390, 320]) {
    await page.setViewportSize({ width, height: 1100 });
    const size = await page.evaluate(() => ({ width: innerWidth, content: document.documentElement.scrollWidth }));
    assert.ok(size.content <= size.width + 1, `Overflow at ${width}: ${size.content}`);
    assert.ok(await chart.locator('canvas').count() > 0);
  }
  await page.setViewportSize({ width: 1600, height: 1100 });
  await page.screenshot({ path: join(tmpdir(), 'monstock-tradingview-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 1000 });
  await page.screenshot({ path: join(tmpdir(), 'monstock-tradingview-mobile.png'), fullPage: true });
  failHistory = true;
  await page.getByRole('button', { name: 'Refresh market activity' }).click();
  await page.getByText(/Sync paused:/).waitFor();
  assert.equal(await page.locator('.sb-holders-panel').first().locator('tbody tr').count(), 2, 'last verified rankings should survive a transient RPC failure');
  assert.deepEqual(errors, []);
  console.log('PASS: TradingView canvas, timeframes, chart controls, contract clipboard, swap quotes, live trade/holder updates, stale-data recovery, five responsive widths, no page errors.');
} finally { await browser.close(); }
