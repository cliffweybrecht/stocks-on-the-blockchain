export const SITE_ORIGIN = "https://stocksontheblockchain.com";

export const SITE_TITLE = "Stocks on the Blockchain";

export const SITE_DESCRIPTION =
  "Read-only volume dashboard for tokenized stocks. Chain first, then the names, then the marks.";

export function canonicalUrl(path: string): string {
  if (path === "/" || path === "") return `${SITE_ORIGIN}/`;
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${SITE_ORIGIN}${normalized}`;
}
