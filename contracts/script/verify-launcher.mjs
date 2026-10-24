import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = new URL('../../', import.meta.url);
const require = createRequire(new URL('../../web/package.json', import.meta.url));
const { encodeAbiParameters } = require('viem');
const deployment = JSON.parse(await readFile(new URL('shared/deployments.json', root), 'utf8'));
const deployer = JSON.parse(await readFile(new URL('shared/deployer.json', root), 'utf8')).address;
if (deployment.chainId !== 10143 || deployment.status !== 'deployed') throw new Error('Verified Monad Testnet deployment required.');
const launcher = JSON.parse(await readFile(new URL('shared/launcher.json', root), 'utf8'));
const isCurve = launcher.model === "bonding-curve";
const jobs = [
  [isCurve ? 'BondingCurveFactory' : 'RewardFactory', launcher.rewardFactory, ['address'], [launcher.treasury]],
  [isCurve ? 'BondingCurveLauncher' : 'StockBackLauncher', launcher.address, ['address[]', 'address'], [launcher.factories, launcher.rewardFactory]],
];
const forge = process.env.FORGE_BIN || (process.platform === 'win32' ? join(homedir(), '.foundry/bin/forge.exe') : 'forge');
const results = {};
for (const [name, address, types, args] of jobs) {
  const contractName = `contracts/src/${name}.sol:${name}`;
  const standardJsonInput = JSON.parse(execFileSync(forge, ['verify-contract', address, contractName, '--chain', '10143', '--show-standard-json-input', '--compiler-version', '0.8.24'], { cwd: fileURLToPath(root), encoding: 'utf8', env: { ...process.env, RUST_LOG: 'error' }, maxBuffer: 16 * 1024 * 1024 }));
  const artifact = JSON.parse(await readFile(new URL(`contracts/out/${name}.sol/${name}.json`, root), 'utf8'));
  const response = await fetch('https://agents.devnads.com/v1/verify', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chainId: 10143, contractAddress: address, contractName, compilerVersion: `v${artifact.metadata.compiler.version}`, standardJsonInput, foundryMetadata: artifact.metadata,
      ...(types.length ? { constructorArgs: encodeAbiParameters(types.map(type => ({ type })), args).slice(2) } : {}),
    }), signal: AbortSignal.timeout(60000),
  });
  const result = await response.json();
  results[address] = { address, httpStatus: response.status, ...result };
  await writeFile(new URL(isCurve ? 'shared/curve-verification.json' : 'shared/launcher-verification.json', root), JSON.stringify({ chainId: 10143, provider: 'agents.devnads.com', contracts: results }, null, 2) + '\n');
  console.log(JSON.stringify({ contract: name, address, success: result.success, verified: result.verified, total: result.total }));
}
if (Object.values(results).some(result => !result.success)) process.exitCode = 1;
