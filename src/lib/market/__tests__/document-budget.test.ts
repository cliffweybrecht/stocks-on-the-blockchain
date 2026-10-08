import { describe, expect, it } from "vitest";
import { withDocumentBudget } from "../document-budget";

describe("withDocumentBudget", () => {
  it("returns the fallback when work is still pending", async () => {
    const started = Date.now();
    const result = await withDocumentBudget(new Promise<string>(() => undefined), "cached", 30);
    expect(result).toBe("cached");
    expect(Date.now() - started).toBeLessThan(500);
  });

  it("returns the finished value when work beats the budget", async () => {
    await expect(withDocumentBudget(Promise.resolve("live"), "cached", 200)).resolves.toBe("live");
  });
});
