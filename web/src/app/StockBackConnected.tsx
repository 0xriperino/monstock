"use client";

import { StockBackApp } from "../components/StockBackApp";
import { useStockBack } from "../hooks/useStockBack";

export function StockBackConnected() {
  const { data, actions } = useStockBack();
  return <StockBackApp data={data} actions={actions} />;
}
