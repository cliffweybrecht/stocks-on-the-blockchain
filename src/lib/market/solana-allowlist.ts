/**
 * Curated Backed xStock mints on Solana. Addresses were resolved from
 * DexScreener pairs whose token name includes "xStock" and whose mint
 * uses Backed's `Xs…` prefix. This is an allowlist, not discovery —
 * unknown Solana tokens are never promoted into the desk.
 */
export interface SolanaAllowlistedMint {
  symbol: string;
  name: string;
  mint: string;
}

export const SOLANA_XSTOCK_MINTS: readonly SolanaAllowlistedMint[] = [
  { symbol: "TSLAx", name: "Tesla xStock", mint: "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB" },
  { symbol: "AAPLx", name: "Apple xStock", mint: "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp" },
  { symbol: "NVDAx", name: "NVIDIA xStock", mint: "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh" },
  { symbol: "GOOGLx", name: "Alphabet xStock", mint: "XsCPL9dNWBMvFtTmwcCA5v3xWPSMEBCszbQdiLLq6aN" },
  { symbol: "AMZNx", name: "Amazon.com xStock", mint: "Xs3eBt7uRfJX8QUs4suhyU8p2M6DoUDrJyWBa8LLZsg" },
  { symbol: "MSFTx", name: "Microsoft xStock", mint: "XspzcW1PRtgf6Wj92HCiZdjzKCyFekVD8P5Ueh3dRMX" },
  { symbol: "METAx", name: "Meta xStock", mint: "Xsa62P5mvPszXL1krVUnU5ar38bBSVcWAB6fmPCo5Zu" },
  { symbol: "SPYx", name: "SP500 xStock", mint: "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W" },
  { symbol: "QQQx", name: "Nasdaq xStock", mint: "Xs8S1uUs1zvS2p7iwtsG3b6fkhpvmwz4GYU3gWAmWHZ" },
  { symbol: "CRCLx", name: "Circle xStock", mint: "XsueG8BtpquVJX9LVLLEGuViXUungE6WmK5YZ3p3bd1" },
  { symbol: "MSTRx", name: "MicroStrategy xStock", mint: "XsP7xzNPvEHS1m6qfanPUGjNmdnmsLKEoNAnHjdxxyZ" },
];

export function mintKey(address: string): string {
  return address.trim();
}

export function findAllowlistedMint(
  address: string | null | undefined,
  mints: readonly SolanaAllowlistedMint[] = SOLANA_XSTOCK_MINTS,
): SolanaAllowlistedMint | null {
  if (!address) return null;
  const needle = mintKey(address);
  return mints.find((entry) => entry.mint === needle) ?? null;
}

export function solanaTokensPath(mints: readonly SolanaAllowlistedMint[] = SOLANA_XSTOCK_MINTS): string {
  return `/tokens/v1/solana/${mints.map((entry) => entry.mint).join(",")}`;
}
