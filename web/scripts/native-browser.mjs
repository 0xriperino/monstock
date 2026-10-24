import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {createPublicClient,createWalletClient,createTestClient,http} from 'viem';
import {stockAbi,nativeRouterAbi,curveLauncherAbi,memeAbi} from '../src/lib/abis.ts';
const deployment={rpcUrl:'http://127.0.0.1:8546'};
const url=process.env.E2E_URL??'http://127.0.0.1:3108';
if(!['localhost','127.0.0.1'].includes(new URL(url).hostname)) throw new Error('Local browser test only.');
const catalog=JSON.parse(await readFile(new URL('../../shared/asset-local.json',import.meta.url),'utf8'));
const asset=catalog.assets[1];
const router=JSON.parse(await readFile(new URL('../../shared/native-router.local.json',import.meta.url),'utf8')).address;
const launcher=JSON.parse(await readFile(new URL('../../shared/launcher.local.json',import.meta.url),'utf8')).address;
const client=createPublicClient({pollingInterval:50,transport:http(deployment.rpcUrl)});
assert.equal(await client.getChainId(),31337);
const account=(await createWalletClient({transport:http(deployment.rpcUrl)}).getAddresses())[7];
const test=createTestClient({mode:'anvil',transport:http(deployment.rpcUrl)});await test.setIntervalMining({interval:1});await test.mine({blocks:1});const checkpoint=await test.snapshot();
const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_PATH??'C:/Program Files/Google/Chrome/Application/chrome.exe'});
const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(45000);
const errors=[];page.on('pageerror',e=>errors.push(e.message));
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
 await page.goto(url);
 await page.locator('.sb-topbar').getByRole('button',{name:'Connect wallet',exact:true}).click();
 await page.getByRole('button',{name:'Trade MONDEMO',exact:true}).click();
 await page.getByRole('button',{name:'Pay with MON',exact:true}).waitFor();
 await page.getByLabel('You pay',{exact:true}).fill('0.05');
 await page.getByText('Estimate ready',{exact:true}).waitFor();
 assert.equal(await page.getByRole('button',{name:'Approve MON',exact:true}).count(),0);
 await confirmed(page.getByRole('button',{name:'Buy MONDEMO',exact:true}).last());
 assert.equal(await client.readContract({address:asset.id,abi:stockAbi,functionName:'balanceOf',args:[account]}),0n);
 console.log('PASS UI: MON purchase with zero quote balance and no token approval.');
 await page.getByRole('button',{name:'Token amount',exact:true}).click();
 await page.getByLabel('You receive',{exact:true}).fill('1000');
 await page.getByText('Estimate ready',{exact:true}).waitFor();
 assert.ok((await page.locator('.sb-swap-output').innerText()).includes('MON'));
 await confirmed(page.getByRole('button',{name:'Buy MONDEMO',exact:true}).last());
 console.log('PASS UI: token quantity input and estimated MON payment.');
 await page.getByRole('button',{name:'Sell MONDEMO',exact:true}).first().click();
 await page.getByLabel('You pay',{exact:true}).fill('1000');
 await page.getByText('Estimate ready',{exact:true}).waitFor();
 await confirmed(page.getByRole('button',{name:'Approve MONDEMO',exact:true}));
 await page.getByText('Estimate ready',{exact:true}).waitFor();
 await confirmed(page.getByRole('button',{name:'Sell MONDEMO',exact:true}).last());
 console.log('PASS UI: sell meme tokens and receive MON.');
 await page.locator('.sb-topbar').getByRole('button',{name:'Launch token',exact:true}).click();
 const form=page.locator('.sb-launch-page');
 await form.getByLabel('Token name',{exact:true}).fill('Native UI');
 await form.getByLabel('Symbol',{exact:true}).fill('NUIMON');
 await form.getByRole('button',{name:'MON amount',exact:true}).click();
 await form.getByLabel('Dev buy amount',{exact:true}).fill('0.02');
 await confirmed(form.getByRole('button',{name:'Launch token',exact:true}));
 const markets=await client.readContract({address:launcher,abi:curveLauncherAbi,functionName:'getMarkets',args:[asset.id]});
 const market=markets[markets.length-1];
 const token=await client.readContract({address:market,abi:(await import('../src/lib/abis.ts')).marketAbi,functionName:'memeToken'});
 assert.equal(await client.readContract({address:router,abi:nativeRouterAbi,functionName:'creatorOf',args:[token]}),account);
 assert.ok(await client.readContract({address:token,abi:memeAbi,functionName:'balanceOf',args:[account]})>0n);
 assert.equal(await client.readContract({address:asset.id,abi:stockAbi,functionName:'balanceOf',args:[account]}),0n);
 assert.deepEqual(errors,[]);
 console.log('PASS UI: launch plus MON dev buy; original creator and zero quote balance preserved.');
} catch(error){console.error((await page.locator('body').innerText()).slice(-4500));throw error;}
finally{await browser.close();await test.revert({id:checkpoint});}
