"use client";

import { useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";
import { wagmiConfig } from "../lib/chain";

export function Providers({ children }: { children: ReactNode }) {
  const [queries] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 3000, refetchOnWindowFocus: true } } }));
  return <WagmiProvider config={wagmiConfig}><QueryClientProvider client={queries}>{children}</QueryClientProvider></WagmiProvider>;
}
