import { describe, expect, it } from "vitest";
import AssetPage from "@/app/(spot)/chains/[chainId]/assets/[symbol]/page";
import ChainPage from "@/app/(spot)/chains/[chainId]/page";

const NOT_FOUND = { digest: "NEXT_HTTP_ERROR_FALLBACK;404" };

describe("disabled Ethereum routes", () => {
  it("returns notFound for /chains/ethereum", async () => {
    await expect(
      ChainPage({
        params: Promise.resolve({ chainId: "ethereum" }),
        searchParams: Promise.resolve({}),
      }),
    ).rejects.toMatchObject(NOT_FOUND);
  });

  it("returns notFound for placeholder Ethereum asset pages", async () => {
    await expect(
      AssetPage({
        params: Promise.resolve({
          chainId: "ethereum",
          symbol: "AAPLon",
        }),
      }),
    ).rejects.toMatchObject(NOT_FOUND);
    await expect(
      AssetPage({
        params: Promise.resolve({
          chainId: "ethereum",
          symbol: "TSLAon",
        }),
      }),
    ).rejects.toMatchObject(NOT_FOUND);
  });
});
