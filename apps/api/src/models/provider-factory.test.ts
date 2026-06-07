import { describe, expect, it } from "vitest";
import { MockModelProvider } from "./mock-provider.js";
import { createModelProvider } from "./provider-factory.js";
import { QwenProvider } from "./qwen-provider.js";

describe("createModelProvider", () => {
  it("returns mock provider by default", () => {
    const resolved = createModelProvider({ kind: "mock" });

    expect(resolved.kind).toBe("mock");
    expect(resolved.model).toBe("mock-reviewer");
    expect(resolved.provider).toBeInstanceOf(MockModelProvider);
  });

  it("returns qwen provider when requested", () => {
    const resolved = createModelProvider({ kind: "qwen" });

    expect(resolved.kind).toBe("qwen");
    expect(resolved.model).toBe("qwen-plus");
    expect(resolved.provider).toBeInstanceOf(QwenProvider);
  });
});
