import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "StockBack — Markets & Portfolio",
  description: "Discover StockBack's stock-inspired meme markets on Monad Testnet.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="en" style={{ colorScheme: "light" }}><body style={{ margin: 0, background: "#ffffff" }}><Providers>{children}</Providers></body></html>;
}
