"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";
import {
  parseFavoriteMints,
  serializeFavoriteMints,
  SOLANA_FAVORITES_STORAGE_KEY,
  toggleFavoriteMint,
} from "@/lib/desk/solana-favorites";

const FAVORITES_EVENT = "sotb-solana-favorites";

function subscribeFavorites(onStoreChange: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === SOLANA_FAVORITES_STORAGE_KEY) onStoreChange();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(FAVORITES_EVENT, onStoreChange);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(FAVORITES_EVENT, onStoreChange);
  };
}

function getFavoriteSnapshot(): string {
  return window.localStorage.getItem(SOLANA_FAVORITES_STORAGE_KEY) ?? "[]";
}

function getServerFavoriteSnapshot(): string {
  return "[]";
}

export function useSolanaFavorites() {
  const raw = useSyncExternalStore(subscribeFavorites, getFavoriteSnapshot, getServerFavoriteSnapshot);
  const mints = useMemo(() => parseFavoriteMints(raw), [raw]);
  const favoriteSet = useMemo(() => new Set(mints), [mints]);

  const persist = useCallback((next: string[]) => {
    window.localStorage.setItem(SOLANA_FAVORITES_STORAGE_KEY, serializeFavoriteMints(next));
    window.dispatchEvent(new Event(FAVORITES_EVENT));
  }, []);

  const toggle = useCallback(
    (mint: string) => {
      persist(toggleFavoriteMint(mints, mint));
    },
    [mints, persist],
  );

  return {
    favoriteMints: mints,
    favoriteSet,
    ready: true,
    isFavorite: (mint: string) => favoriteSet.has(mint),
    toggle,
  };
}
