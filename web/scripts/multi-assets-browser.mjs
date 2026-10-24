import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createPublicClient, createWalletClient, createTestClient, http, parseEther } from 'viem';
const deployment = { rpcUrl: 'http://127.0.0.1:8546' };
const url = 'http://127.0.0.1:3104';
const catalog = JSON.parse(await readFile(new URL('../../shared/asset-local.json', import.meta.url), 'utf8'));
const client = createPublicClient({transport:http(deployment.rpcUrl)});
assert.equal(await client.getChainId(),31337);
const test=createTestClient({mode:"anvil",transport:http(deployment.rpcUrl)});
const checkpoint=await test.snapshot();
const account=(await createWalletClient({transport:http(deployment.rpcUrl)}).getAddresses())[4];
const stockAbi=JSON.parse(await readFile(new URL('../../contracts/out/MockStock.sol/MockStock.json',import.meta.url),'utf8')).abi;
const launcherAbi=JSON.parse(await readFile(new URL('../../contracts/out/StockBackLauncher.sol/StockBackLauncher.json',import.meta.url),'utf8')).abi;
const launcher=JSON.parse(await readFile(new URL('../../shared/launcher.local.json',import.meta.url),'utf8')).address;
const marketAbi=JSON.parse(await readFile(new URL('../../contracts/out/MemeMarket.sol/MemeMarket.json',import.meta.url),'utf8')).abi;
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
const context=await browser.newContext({viewport:{width:1440,height:1000}});
const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(45000);
await page.addInitScript(({ account, rpc }) => {
  const listeners = new Map();
  let authorized = false;
  let currentChain = '0x7a69';
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

async function confirmed(button) {
 const last=await page.locator('.sb-transaction .sb-hash').count() ? await page.locator('.sb-transaction .sb-hash').textContent() : ''; 
 await button.click();
 await page.waitForFunction(previous=>{const hash=document.querySelector('.sb-transaction--success .sb-hash')?.textContent;return hash&&hash!==previous;},last,{timeout:45000});
}
try {
 await page.goto(url); console.log('Loaded');
 await page.locator('.sb-topbar').getByRole('button',{name:'Connect wallet',exact:true}).click();
 await page.getByRole('button',{name:'Launch token',exact:true}).click();
 const dialog=page.locator('.sb-launch-page');
 for (const [index,asset] of catalog.assets.entries()) { console.log('Testing',asset.symbol);
  await dialog.getByRole('group',{name:'Launch quote asset',exact:true}).getByRole('button').filter({hasText:asset.symbol}).click();
  await dialog.getByLabel('Token name',{exact:true}).fill('UI '+asset.symbol);
  await dialog.getByLabel('Symbol',{exact:true}).fill('UI'+index);
  await dialog.getByLabel('Initial stock liquidity',{exact:true}).fill('100');
  console.log('Waiting faucet',asset.symbol); await confirmed(dialog.getByRole('button',{name:'Get test '+asset.symbol,exact:true})); console.log('Faucet confirmed');
  await confirmed(dialog.getByRole('button',{name:'Launch token',exact:true}));
  const pools=await client.readContract({address:launcher,abi:launcherAbi,functionName:'getMarkets',args:[asset.id]});
  assert.ok(pools.length>=1);
  const quote=await client.readContract({address:pools[pools.length-1],abi:marketAbi,functionName:'stockToken'});
  assert.equal(quote.toLowerCase(),asset.id.toLowerCase());
  assert.equal(await client.readContract({address:asset.id,abi:stockAbi,functionName:'balanceOf',args:[account]}),parseEther('9900'));
  console.log('PASS browser launch/faucet/pair',asset.symbol);
 }
 await dialog.getByRole('button',{name:'Back to discover'}).click();
 assert.equal(await page.getByRole('combobox',{name:'Pair asset',exact:true}).count(), 0);
 for (const index of catalog.assets.keys()) {
  await page.getByRole('button',{name:`Trade UI${index}`,exact:true}).waitFor();
  assert.ok((await page.getByRole('button',{name:`Trade UI${index}`,exact:true}).innerText()).includes(catalog.assets[index].symbol));
 }
 await page.getByRole('button',{name:'Trade UI1',exact:true}).click();
 await page.getByLabel('You pay',{exact:true}).fill('10');
 await page.getByText('Estimate ready',{exact:true}).waitFor();
 await confirmed(page.getByRole('button',{name:'Approve NVDAX',exact:true}));
 await page.getByRole('button',{name:'Refresh trade estimate'}).click();
 await page.getByText('Estimate ready',{exact:true}).waitFor();
 await confirmed(page.getByRole('button',{name:'Buy UI1',exact:true}).last());
 assert.deepEqual(errors,[]);
 console.log('PASS browser NVDAX approval and buy; no runtime errors.');
} catch(error) { console.log((await page.locator('body').innerText()).slice(-6000)); console.log(errors); throw error; } finally { await browser.close(); await test.revert({id:checkpoint}); }
