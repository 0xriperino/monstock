import { readFile, writeFile, mkdir } from 'node:fs/promises';
const root = new URL('../../', import.meta.url);
const names = { MockStock: 'stockAbi', MemeToken: 'memeAbi', MemeMarket: 'marketAbi', StockVault: 'vaultAbi', StockBackFactory: 'factoryAbi' };
await mkdir(new URL('web/src/lib', root), { recursive: true });
let source = '// Generated from actual Foundry artifacts. Run forge build then node contracts/script/export-abis.mjs.\n';
for (const [name, exported] of Object.entries(names)) {
  const artifact = JSON.parse(await readFile(new URL(`contracts/out/${name}.sol/${name}.json`, root), 'utf8'));
  if (!Array.isArray(artifact.abi)) throw new Error(`Missing compiled ABI: ${name}`);
  source += `export const ${exported} = ${JSON.stringify(artifact.abi)} as const;\n`;
}
await writeFile(new URL('web/src/lib/abis.ts', root), source);
console.log('Exported five compiled Foundry ABIs.');
