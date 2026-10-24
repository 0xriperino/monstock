import { StockBackPreview } from "../components/preview/StockBackPreview";

// Explicit synthetic preview until the wallet integration is supplied.
// The connected host can render StockBackApp with the same data/actions contract.
export default function Home() {
  return <StockBackPreview />;
}
