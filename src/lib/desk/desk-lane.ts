import type { InstrumentKind } from "../market/types";

export function parseDeskLane(
  value: string | string[] | undefined,
  available: { etf: boolean; private: boolean },
): InstrumentKind {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === "etf" && available.etf) return "etf";
  if (raw === "private" && available.private) return "private";
  return "equity";
}

export function deskLaneLabel(lane: InstrumentKind): string {
  if (lane === "etf") return "ETF / index";
  if (lane === "private") return "Private market";
  return "Equities";
}

export function deskLaneQueryValue(lane: InstrumentKind): string | null {
  return lane === "etf" || lane === "private" ? lane : null;
}

export function instrumentKindShortLabel(kind: InstrumentKind | undefined): string | null {
  if (kind === "etf") return "ETF";
  if (kind === "private") return "Private";
  return null;
}
