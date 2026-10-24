import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createPublicClient, fallback } from "viem";
import { rateLimitedHttp } from "./rpc";

test("public RPC rate-limit errors recover without losing parallel reads", async () => {
  let limited = true;
  const arrivals: number[] = [];
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const input = JSON.parse(body);
    arrivals.push(performance.now());
    res.setHeader("Content-Type", "application/json");
    if (limited) {
      limited = false;
      res.end(JSON.stringify({ jsonrpc: "2.0", id: input.id, error: { code: -32000, message: "requests limited to 15/sec" } }));
    } else res.end(JSON.stringify({ jsonrpc: "2.0", id: input.id, result: "0x279f" }));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const client = createPublicClient({ transport: rateLimitedHttp(`http://127.0.0.1:${address.port}`) });
    const read = async () => Number(await client.request({ method: "eth_chainId" }, { dedupe: false }));
    const values = await Promise.allSettled([read(), read(), read()]);
    assert.deepEqual(values, [10143, 10143, 10143].map(value => ({ status: "fulfilled", value })));
    assert.ok(arrivals.length >= 4, "the rejected read must be retried");
    assert.ok(arrivals.at(-1)! - arrivals[0] >= 1000, "a limited endpoint must receive a recovery pause");
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

test("a throttled primary RPC falls back without exhausting repeated retries", async () => {
  const paths: string[] = [];
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const input = JSON.parse(body);
    paths.push(req.url!);
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(req.url === "/limited"
      ? { jsonrpc: "2.0", id: input.id, error: { code: -32000, message: "requests limited to 15/sec" } }
      : { jsonrpc: "2.0", id: input.id, result: "0x279f" }));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}`;
    const client = createPublicClient({ transport: fallback([rateLimitedHttp(`${base}/limited`, { retryCount: 0 }), rateLimitedHttp(`${base}/healthy`, { retryCount: 0 })], { retryCount: 0 }) });
    assert.equal(await client.getChainId(), 10143);
    assert.deepEqual(paths, ["/limited", "/healthy"]);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
