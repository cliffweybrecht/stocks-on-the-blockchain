"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

type DeskHeaderActionsContextValue = {
  slot: HTMLElement | null;
  setSlot: (node: HTMLElement | null) => void;
};

const DeskHeaderActionsContext = createContext<DeskHeaderActionsContextValue | null>(null);

export function DeskHeaderActionsProvider({ children }: { children: ReactNode }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const value = useMemo(() => ({ slot, setSlot }), [slot]);
  return <DeskHeaderActionsContext.Provider value={value}>{children}</DeskHeaderActionsContext.Provider>;
}

/**
 * Anchor in the site header, immediately after Jump.
 * `display: contents` keeps an empty slot from adding a flex gap.
 */
export function DeskHeaderActionsSlot() {
  const ctx = useContext(DeskHeaderActionsContext);
  return <div ref={ctx?.setSlot} className="contents" data-desk-header-actions />;
}

/** Places children in the header slot (Export CSV sits beside Jump, not the sort chips). */
export function DeskHeaderActions({ children }: { children: ReactNode }) {
  const ctx = useContext(DeskHeaderActionsContext);
  if (!ctx?.slot) return null;
  return createPortal(children, ctx.slot);
}
