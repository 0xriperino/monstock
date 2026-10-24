import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createPublicClient } from "viem";
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
    const values = await Promise.allSettled([client.getChainId(), client.getChainId(), client.getChainId()]);
    assert.deepEqual(values, [10143, 10143, 10143].map(value => ({ status: "fulfilled", value })));
    assert.ok(arrivals.length >= 4, "the rejected read must be retried");
    assert.ok(arrivals.at(-1)! - arrivals[0] >= 1000, "a limited endpoint must receive a recovery pause");
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
