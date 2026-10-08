import { describe, expect, it } from "vitest";
import { sparklineGeometry, sparklineGeometryFromValues, SPARKLINE_HEIGHT, SPARKLINE_PAD_X } from "../sparkline-path";

describe("sparklineGeometry", () => {
  it("returns null without two points", () => {
    expect(sparklineGeometry([])).toBeNull();
    expect(sparklineGeometry([{ t: 1, volumeUsd: 4 }])).toBeNull();
  });

  it("places the last point at the right edge and keeps a rising series above the floor", () => {
    const geometry = sparklineGeometry([
      { t: 1, volumeUsd: 1 },
      { t: 2, volumeUsd: 5 },
      { t: 3, volumeUsd: 9 },
    ]);
    expect(geometry).not.toBeNull();
    expect(geometry?.lastX).toBeGreaterThan(SPARKLINE_PAD_X);
    expect(geometry?.lastY).toBeLessThan(SPARKLINE_HEIGHT / 2);
    expect(geometry?.line.startsWith("M ")).toBe(true);
    expect(geometry?.line).toMatch(/ C /);
    expect(geometry?.area).toMatch(/ C /);
    expect(geometry?.area.endsWith("Z")).toBe(true);
  });

  it("rejects a non-finite price series instead of drawing a fake line", () => {
    expect(sparklineGeometryFromValues([10, Number.NaN, 12])).toBeNull();
    expect(sparklineGeometryFromValues([10])).toBeNull();
  });
});
