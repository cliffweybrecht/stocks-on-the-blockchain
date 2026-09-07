import { MockMarketDataSource } from "./mock-source";
import { TerminalMarketDataSource } from "./terminal-source";
import type { MarketDataSource } from "./types";

export function getTerminalBaseUrl(): string | null {
  const value = process.env.TERMINAL_BASE_URL?.trim();
  return value ? value : null;
}

export function createMarketDataSource(): MarketDataSource {
  const baseUrl = getTerminalBaseUrl();
  if (baseUrl) {
    return new TerminalMarketDataSource(baseUrl);
  }
  return new MockMarketDataSource();
}
