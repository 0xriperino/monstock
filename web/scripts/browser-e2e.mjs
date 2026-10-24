import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createPublicClient, createTestClient, http, parseUnits, formatUnits } from 'viem';

// Test-only injected EIP-1193 transport. It forwards REAL transactions to unlocked
// LOCAL Anvil accounts; this provider is never imported into the application.
const deployment = JSON.parse(await readFile(new URL('../../shared/deployments.local.json', import.meta.url), 'utf8'));
const url = process.env.E2E_URL ?? 'http://127.0.0.1:3100';
for (const endpoint of [url, deployment.rpcUrl]) if (!['localhost', '127.0.0.1'].includes(new URL(endpoint).hostname)) throw new Error('Browser E2E only permits local endpoints.');
const client = createPublicClient({ transport: http(deployment.rpcUrl) });
assert.equal(await client.getChainId(), 31337);
const test = createTestClient({ mode: 'anvil', transport: http(deployment.rpcUrl) });
const checkpoint = await test.snapshot();
const artifact = async name => JSON.parse(await readFile(new URL(`../../contracts/out/${name}.sol/${name}.json`, import.meta.url), 'utf8')).abi;
const stockAbi = await artifact('MockStock');
const launcherAbi = await artifact('BondingCurveLauncher');
const marketAbi = await artifact('MemeMarket');
const account = deployment.accounts.treasury;
const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_PATH ? { executablePath: process.env.BROWSER_PATH } : process.platform === 'win32' ? { executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' } : {}) });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
await page.addInitScript(({ account, rpc }) => {
  const listeners = new Map();
  let authorized = false;
  let currentChain = '0x1';
  const provider = {
    isMetaMask: true,
    on(name, fn) { const list = listeners.get(name) ?? []; list.push(fn); listeners.set(name, list); return provider; },
    removeListener(name, fn) { listeners.set(name, (listeners.get(name) ?? []).filter(item => item !== fn)); return provider; },
    async request({ method, params = [] }) {
      if (method === 'eth_accounts') return authorized ? [account] : [];
      if (method === 'eth_requestAccounts') { authorized = true; return [account]; }
      if (method === 'eth_chainId') return currentChain;
      if (method === 'wallet_requestPermissions') { authorized = true; return [{ parentCapability: 'eth_accounts' }]; }
      if (method === 'wallet_switchEthereumChain') { currentChain = params[0].chainId; for (const fn of listeners.get('chainChanged') ?? []) fn(currentChain); return null; }
      if (method === 'wallet_addEthereumChain') return null;
      if (method === 'eth_sendTransaction' && window.__rejectNextTransaction) { window.__rejectNextTransaction = false; const error = new Error('User rejected the request.'); error.code = 4001; throw error; }
      const response = await fetch(rpc, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }).then(res => res.json());
      if (response.error) { const error = new Error(response.error.message); error.code = response.error.code; throw error; }
      return response.result;
    },
  };
  Object.defineProperty(window, 'ethereum', { value: provider });
}, { account, rpc: deployment.rpcUrl });
async function syncClock() { const block = await client.getBlock(); await page.clock.setFixedTime(new Date(Number(block.timestamp) * 1000)); }
async function confirmed(button) {
  const last = await page.locator('.sb-transaction .sb-hash').textContent().catch(() => '');
  await button.click();
  await page.waitForFunction(previous => {
    const hash = document.querySelector('.sb-transaction--success .sb-hash')?.textContent;
    return hash && hash !== previous;
  }, last, { timeout: 30_000 });
}
async function tab(name) { await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name, exact: true }).click(); }
async function refreshQuote() { await page.getByRole('button', { name: 'Refresh trade estimate' }).click(); await page.getByText('Estimate ready', { exact: true }).waitFor(); }
try {
  await syncClock();
  await page.goto(url);
  await page.getByRole('button', { name: 'Trade SBDEMO', exact: true }).waitFor();
  assert.equal(await page.getByRole('region', { name: 'Blockchain connection' }).count(), 0);
  assert.equal(await page.getByText(/Synthetic data/).count(), 0);
  assert.equal(await page.getByText('preview-wallet', { exact: true }).count(), 0);
  await page.locator('.sb-topbar').getByRole('button', { name: 'Connect wallet', exact: true }).click();
  await page.getByRole('button', { name: 'Switch network', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Switch network', exact: true }).click();
  await tab('Portfolio');
  await confirmed(page.getByRole('button', { name: 'Get test tokens', exact: true }));
  assert.equal(await client.readContract({ address: deployment.contracts.stockToken, abi: stockAbi, functionName: 'balanceOf', args: [account] }), parseUnits('10000', 18));
  await page.getByRole('button', { name: 'Launch token', exact: true }).click();
  const dialog = page.locator('.sb-launch-page');
  await dialog.getByLabel('Token name', { exact: true }).fill('Browser Meme');
  await dialog.getByLabel('Symbol', { exact: true }).fill('BROW');
  await confirmed(dialog.getByRole('button', { name: 'Launch token', exact: true }));
  await page.getByRole('button', { name: 'Back to discover' }).click();
  const markets = await client.readContract({ address: deployment.contracts.launcher, abi: launcherAbi, functionName: 'getMarkets', args:[deployment.contracts.stockToken] });
  assert.equal(markets.length, 1);
  const market = markets[0];
  await page.getByRole('button', { name: 'Trade BROW', exact: true }).click();
  await page.getByLabel('You pay', { exact: true }).fill('10');
  await page.getByText('Estimate ready', { exact: true }).waitFor();
  await page.evaluate(() => { window.__rejectNextTransaction = true; });
  await page.getByRole('button', { name: 'Approve SPYX', exact: true }).click();
  await page.locator('.sb-transaction--error').waitFor();
  assert.equal(await page.locator('.sb-transaction--success').count(), 0);
  await confirmed(page.getByRole('button', { name: 'Approve SPYX', exact: true }));
  await refreshQuote();
  await confirmed(page.getByRole('button', { name: 'Buy BROW', exact: true }).last());
  await page.getByRole('button', { name: 'Sell BROW', exact: true }).first().click();
  await page.getByLabel('You pay', { exact: true }).fill('100');
  await page.getByText('Estimate ready', { exact: true }).waitFor();
  await confirmed(page.getByRole('button', { name: 'Approve BROW', exact: true }));
  await refreshQuote();
  await confirmed(page.getByRole('button', { name: 'Sell BROW', exact: true }).last());
  await test.increaseTime({ seconds: 301 }); await test.mine({ blocks: 1 });
  await syncClock();
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent === 'Settle epoch' && !button.disabled), null, { timeout: 30_000 });
  await confirmed(page.getByRole('button', { name: 'Settle epoch', exact: true }));
  const reward = await client.readContract({ address: market, abi: marketAbi, functionName: 'pendingHolderRewards', args: [account] });
  assert.ok(reward > 0n);
  await confirmed(page.getByRole('button', { name: 'Claim rewards', exact: true }));
  await tab('AutoVault');
  for (const [amount, days] of [[formatUnits(reward, 18), 30], ['2', 90]]) {
    await page.getByLabel('Deposit amount', { exact: true }).fill(amount);
    await page.getByRole('radio', { name: new RegExp(`^${days} days`) }).check();
    await page.getByRole('checkbox', { name: /I understand/ }).check();
    await confirmed(page.getByRole('button', { name: 'Approve SPYX', exact: true }));
    await confirmed(page.getByRole('button', { name: `Lock for ${days} days`, exact: true }));
  }
  await page.getByText('2 positions', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: /Locked until/ }).count(), 2);
  assert.equal(await page.getByRole('button', { name: /Locked until/ }).first().isDisabled(), true);
  await test.increaseTime({ seconds: 30 * 86400 + 1 }); await test.mine({ blocks: 1 });
  await syncClock();
  await page.getByRole('button', { name: 'Withdraw position', exact: true }).waitFor({ timeout: 30_000 });
  await confirmed(page.getByRole('button', { name: 'Withdraw position', exact: true }));
  await page.getByText('1 positions', { exact: true }).waitFor();
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const name of ['Discover', 'Trade', 'AutoVault', 'Portfolio']) {
      await tab(name);
      const size = await page.evaluate(() => ({ width: innerWidth, content: document.documentElement.scrollWidth }));
      assert.ok(size.content <= size.width + 1, `Overflow at ${width}/${name}`);
    }
  }
  assert.deepEqual(errors, []);
  console.log('PASS: all 14 UI callbacks against REAL LOCAL Anvil transactions, wrong-network switching, approval rejection/retry, actual receipts, two vault deposits, locked controls, successful local unlock, 12 responsive view checks, no page errors.');
} catch (error) {
  console.error('Current UI:', (await page.locator('body').innerText()).slice(0, 4500));
  throw error;
} finally {
  await browser.close();
  await test.revert({ id: checkpoint });
  console.log('Restored the pre-test local demo state and clock.');
}
