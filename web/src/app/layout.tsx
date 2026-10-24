import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "StockBack — Memes meet markets",
  description: "Discover StockBack's MockSPYx meme markets on Monad Testnet.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="en"><body style={{ margin: 0, background: "#09090f" }}>{children}</body></html>;
}
