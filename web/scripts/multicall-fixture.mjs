import { decodeFunctionData, encodeFunctionResult, multicall3Abi, parseAbi } from 'viem';

const balanceAbi = parseAbi(['function getEthBalance(address) view returns (uint256)']);

export function respondToMulticall(request, respond) {
  if (request.method !== 'eth_call') return;
  if (request.params[0].data?.startsWith('0x4d2301cc')) {
    const { args } = decodeFunctionData({ abi: balanceAbi, data: request.params[0].data });
    const response = respond({ ...request, method: 'eth_getBalance', params: [args[0], request.params[1] ?? 'latest'] });
    return response.error ? response : { jsonrpc: '2.0', id: request.id, result: encodeFunctionResult({ abi: balanceAbi, functionName: 'getEthBalance', result: BigInt(response.result) }) };
  }
  if (!request.params[0].data?.startsWith('0x82ad56cb')) return;
  const { args } = decodeFunctionData({ abi: multicall3Abi, data: request.params[0].data });
  const result = args[0].map(call => {
    try {
      const response = respond({ ...request, params: [{ ...request.params[0], to: call.target, data: call.callData }, ...request.params.slice(1)] });
      return { success: !response.error, returnData: response.result ?? '0x' };
    } catch (error) {
      if (!call.allowFailure) throw error;
      return { success: false, returnData: '0x' };
    }
  });
  return { jsonrpc: '2.0', id: request.id, result: encodeFunctionResult({ abi: multicall3Abi, functionName: 'aggregate3', result }) };
}
