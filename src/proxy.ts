import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { isChainEnabled } from "@/lib/market/chain-config";

/**
 * Disabled spot chains (Ethereum while `enabled` is false) have no page.
 * Rewriting to an unmatched path uses the app not-found screen and a 404.
 * `notFound()` in the chain and asset pages still covers renders that skip this proxy.
 */
export function proxy(request: NextRequest) {
  const match = request.nextUrl.pathname.match(/^\/chains\/([^/]+)(?:\/|$)/);
  if (!match) return NextResponse.next();
  const chainId = decodeURIComponent(match[1] ?? "");
  if (isChainEnabled(chainId)) return NextResponse.next();
  const url = request.nextUrl.clone();
  url.pathname = "/__disabled_chain__";
  return NextResponse.rewrite(url);
}

export const config = {
  matcher: ["/chains/:path*"],
};
