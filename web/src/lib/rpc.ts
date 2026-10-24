import { http, type Transport } from "viem";

// The public Monad endpoint limits requests to 15/sec. Share one smooth queue
// across reads and wallet transports in this browser/process to stay below it.
const slots = new Map<string, number>();
export function rateLimitedHttp(url: string): Transport {
  const base = http(url, { retryCount: 3, retryDelay: 1000 });
  return options => {
    const transport = base(options);
    const request: typeof transport.request = async (args, requestOptions) => {
      for (let attempt = 0; ; attempt++) {
        const now = performance.now();
        const at = Math.max(now, slots.get(url) ?? 0);
        slots.set(url, at + 220);
        if (at > now) await new Promise(resolve => setTimeout(resolve, at - now));
        try { return await transport.request(args, requestOptions); }
        catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          if (attempt >= 3 || !/requests limited|rate.?limit|too many requests|429/i.test(detail)) throw error;
          // RPC providers may report their limiter as a JSON-RPC error with HTTP
          // 200, which the normal HTTP retry policy does not always retry.
          slots.set(url, Math.max(slots.get(url) ?? 0, performance.now() + 2000 * (attempt + 1)));
        }
      }
    };
    return { ...transport, request };
  };
}
