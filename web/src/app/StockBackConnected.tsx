"use client";

import { StockBackApp } from "../components/StockBackApp";
import { useStockBack } from "../hooks/useStockBack";
import { localMode } from "../lib/chain";

export function StockBackConnected() {
  const { data, actions, deploymentReady, refresh } = useStockBack();
  return <>
    <div className="integration-bar" role="region" aria-label="Blockchain connection">
      <span><strong>{localMode ? "LOCAL ANVIL" : "MONAD TESTNET"}</strong> · {deploymentReady ? "Contract data from blockchain" : "Awaiting contract deployment — no demo balances"}</span>
      {data.markets.length > 0 && <label>Vault destination <select aria-label="Vault destination market" value={data.selectedMarketId ?? ""} disabled={data.transaction.status === "pending"} onChange={event => actions.selectMarket(event.target.value)}>{data.markets.map(m => <option key={m.id} value={m.id}>{m.token.symbol} / {data.stockToken.symbol}</option>)}</select></label>}
      <span>Positions include your {data.stockToken.symbol} markets.</span>
      <button type="button" onClick={() => { void refresh(); }} disabled={!deploymentReady || data.transaction.status === "pending"}>Refresh chain data</button>
    </div>
    <StockBackApp data={data} actions={actions} />
  </>;
}
