import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

export const alt = "Stocks on the Blockchain";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OpenGraphImage() {
  const font = await readFile(join(process.cwd(), "node_modules/geist/dist/fonts/geist-sans/Geist-SemiBold.ttf"));
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          backgroundColor: "#080808",
          padding: "72px",
          fontFamily: "Geist",
        }}
      >
        <div style={{ display: "flex", color: "#B7FF3C", fontSize: 28, letterSpacing: "0.14em" }}>
          STOCKS ON THE BLOCKCHAIN
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", color: "#f2f2ea", fontSize: 68, lineHeight: 1.05 }}>
            Tokenized stock volume
          </div>
          <div style={{ display: "flex", color: "#B7FF3C", fontSize: 30, marginTop: 28 }}>
            Chain, then the names, then the marks.
          </div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [{ name: "Geist", data: font, style: "normal", weight: 600 }],
    },
  );
}
