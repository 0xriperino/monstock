import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { decodeFunctionData, encodeFunctionResult, parseAbi, parseUnits } from 'viem';

// Isolated UI regression tests. The wallet and RPC are fixtures; no transaction
// is signed, broadcast, or sent to a real network, and no user profile is opened.
const url = process.env.E2E_URL ?? 'http://127.0.0.1:3101';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(url).hostname), 'Only a local app may be tested.');
const deployment = JSON.parse(await readFile(new URL('../../shared/deployments.json', import.meta.url), 'utf8'));
const abi = parseAbi([
  'function stockToken() view returns (address)',
  'function getMarkets() view returns (address[])',
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address,address) view returns (uint256)',
  'function hasClaimed(address) view returns (bool)',
  'function faucet()',
  'function createCoin(string,string,uint256) returns (address,address,address)',
]);
const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_PATH ? { executablePath: process.env.BROWSER_PATH } : {}) });
let passed = 0;

async function scenario(name, options, check) {
  const context = await browser.newContext({ viewport: { width: options.width ?? 1440, height: 1000 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await context.route('https://testnet-rpc.monad.xyz/**', async route => {
    const request = route.request().postDataJSON();
    function respond(item) {
      const response = { jsonrpc: '2.0', id: item.id };
      if (item.method === 'eth_chainId') return { ...response, result: '0x279f' };
      if (item.method === 'eth_getCode') return { ...response, result: '0x6000' };
      if (item.method === 'eth_getBlockByNumber') return { ...response, result: { number: '0x1', hash: `0x${'0'.repeat(64)}`, timestamp: '0x69000000', transactions: [] } };
      if (item.method === 'eth_call') {
        const { functionName } = decodeFunctionData({ abi, data: item.params[0].data });
        if (functionName === 'balanceOf' && options.balanceError) return { ...response, error: { code: -32000, message: 'Balance RPC unavailable' } };
        const result = {
          stockToken: deployment.contracts.stockToken,
          getMarkets: [],
          balanceOf: parseUnits(options.balance ?? '10000', 18),
          allowance: 2n ** 256n - 1n,
          hasClaimed: options.claimed ?? false,
          faucet: undefined,
          createCoin: Array(3).fill('0x0000000000000000000000000000000000000022'),
        }[functionName];
        return { ...response, result: encodeFunctionResult({ abi, functionName, result }) };
      }
      throw new Error(`Unexpected fixture RPC: ${item.method}`);
    }
    await route.fulfill({ json: Array.isArray(request) ? request.map(respond) : respond(request) });
  });
  if (!options.noWallet) await page.addInitScript(options => {
    const listeners = new Map();
    let authorized = false;
    let chainId = options.correctNetwork ? '0x279f' : '0x1';
    let rejectConnect = options.rejectConnect;
    window.__walletCalls = [];
    const provider = {
      isMetaMask: true,
      on(name, fn) { const entries = listeners.get(name) ?? []; entries.push(fn); listeners.set(name, entries); return provider; },
      removeListener(name, fn) { listeners.set(name, (listeners.get(name) ?? []).filter(entry => entry !== fn)); return provider; },
      async request({ method, params = [] }) {
        window.__walletCalls.push(method);
        if (method === 'eth_accounts') return authorized ? ['0x0000000000000000000000000000000000000011'] : [];
        if (method === 'eth_requestAccounts') {
          if (rejectConnect) { rejectConnect = false; throw Object.assign(new Error('User rejected the request.'), { code: 4001 }); }
          authorized = true;
          return ['0x0000000000000000000000000000000000000011'];
        }
        if (method === 'eth_chainId') return chainId;
        if (method === 'wallet_requestPermissions') { authorized = true; return [{ parentCapability: 'eth_accounts' }]; }
        if (method === 'wallet_switchEthereumChain') {
          chainId = params[0].chainId;
          for (const fn of listeners.get('chainChanged') ?? []) fn(chainId);
          return null;
        }
        // Deliberately reject any signing request; never broadcast real transactions.
        if (method === 'eth_sendTransaction') throw Object.assign(new Error('User rejected the request.'), { code: 4001 });
        throw new Error(`Unexpected fixture wallet request: ${method}`);
      },
    };
    Object.defineProperty(window, 'ethereum', { value: provider });
  }, options);
  try {
    await page.goto(url);
    await page.getByRole('button', { name: 'Launch a coin', exact: true }).first().click();
    const dialog = page.getByRole('dialog');
    await dialog.waitFor();
    await check(page, dialog);
    assert.deepEqual(errors, []);
    console.log(`PASS: ${name}`);
    passed++;
  } catch (error) {
    console.error(`FAIL: ${name}`, (await page.locator('body').innerText()).slice(-5000));
    throw error;
  } finally { await context.close(); }
}

async function fill(dialog, amount = '5000') {
  await dialog.getByLabel('Token name', { exact: true }).fill('YSToken');
  await dialog.getByLabel('Ticker', { exact: true }).fill('YS');
  await dialog.getByLabel('Initial stock liquidity', { exact: true }).fill(amount);
}
async function connect(dialog) {
  const button = dialog.getByRole('button', { name: 'Connect wallet', exact: true });
  await button.waitFor();
  assert.equal(await button.isEnabled(), true);
  await button.click();
}
try {
  await scenario('Connect and switch network inside the launch dialog without losing input', {}, async (page, dialog) => {
    await fill(dialog);
    await connect(dialog);
    const change = dialog.getByRole('button', { name: 'Switch to Monad Testnet', exact: true });
    await change.waitFor();
    await change.click();
    const create = dialog.getByRole('button', { name: 'Create coin', exact: true });
    await page.waitForFunction(() => { const button = document.querySelector('dialog button[type="submit"]'); return button && !button.disabled; });
    assert.equal(await create.isEnabled(), true);
    assert.equal(await dialog.getByLabel('Token name', { exact: true }).inputValue(), 'YSToken');
    assert.equal(await dialog.getByLabel('Initial stock liquidity', { exact: true }).inputValue(), '5000');
    assert.equal((await page.evaluate(() => window.__walletCalls)).includes('eth_sendTransaction'), false);
    await create.click();
    await dialog.getByRole('alert').waitFor();
    assert.equal((await page.evaluate(() => window.__walletCalls)).includes('eth_sendTransaction'), true);
    assert.equal(await dialog.getByText(/Transaction confirmed/).count(), 0);
  });
  await scenario('Wallet can connect before required form fields are filled', { correctNetwork: true }, async (page, dialog) => {
    await connect(dialog);
    await dialog.getByRole('button', { name: 'Create coin', exact: true }).waitFor();
    assert.equal(await dialog.getByRole('button', { name: 'Create coin', exact: true }).isDisabled(), true);
    await fill(dialog, '0');
    assert.equal(await dialog.getByRole('button', { name: 'Create coin', exact: true }).isDisabled(), true);
    await dialog.getByLabel('Initial stock liquidity', { exact: true }).fill('1');
    await page.waitForFunction(() => { const button = document.querySelector('dialog button[type="submit"]'); return button && !button.disabled; });
  });
  await scenario('Missing wallet error is visible inside the modal', { noWallet: true }, async (_page, dialog) => {
    await connect(dialog);
    await dialog.getByRole('alert').filter({ hasText: /Install or enable/ }).waitFor();
  });
  await scenario('Rejected wallet connection stays visible and can be retried', { correctNetwork: true, rejectConnect: true }, async (_page, dialog) => {
    await connect(dialog);
    await dialog.getByRole('alert').waitFor();
    await connect(dialog);
    await dialog.getByRole('button', { name: 'Create coin', exact: true }).waitFor();
    assert.equal(await dialog.getByRole('alert').count(), 0);
  });
  await scenario('Insufficient balance exposes the faucet and signing rejection in the modal', { correctNetwork: true, balance: '0', width: 390 }, async (page, dialog) => {
    await fill(dialog);
    await connect(dialog);
    const faucet = dialog.getByRole('button', { name: 'Get test MockSPYx', exact: true });
    await faucet.waitFor();
    assert.equal(await dialog.getByRole('button', { name: 'Create coin', exact: true }).isDisabled(), true);
    await faucet.click();
    await dialog.getByRole('alert').waitFor();
    const size = await page.evaluate(() => ({ width: innerWidth, content: document.documentElement.scrollWidth }));
    assert.ok(size.content <= size.width + 1, 'Mobile dialog must not overflow horizontally.');
  });
  await scenario('Unavailable balances display a reason and block creation', { correctNetwork: true, balanceError: true }, async (_page, dialog) => {
    await fill(dialog);
    await connect(dialog);
    await dialog.getByRole('alert').filter({ hasText: /balance|RPC/i }).waitFor({ timeout: 30_000 });
    assert.equal(await dialog.getByRole('button', { name: 'Create coin', exact: true }).isDisabled(), true);
  });
  console.log(`${passed} launch-dialog regression scenarios passed. No real transactions submitted.`);
} finally { await browser.close(); }
