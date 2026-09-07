"use client";

import { PinButton } from "@/components/pin-button";
import { useSolanaFavorites } from "@/components/use-solana-favorites";

export function AssetPin({ mint, label }: { mint: string; label: string }) {
  const { isFavorite, toggle } = useSolanaFavorites();
  return <PinButton pinned={isFavorite(mint)} label={label} onToggle={() => toggle(mint)} />;
}
