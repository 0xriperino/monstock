import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "StockBack — Memes meet markets",
  description: "Discover StockBack's MockSPYx meme markets on Monad Testnet.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="en"><body style={{ margin: 0, background: "#09090f" }}><Providers>{children}</Providers></body></html>;
}
