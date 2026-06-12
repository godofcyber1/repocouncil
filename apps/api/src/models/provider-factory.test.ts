import { describe, expect, it } from "vitest";
import { MockModelProvider } from "./mock-provider.js";
import { createModelProvider } from "./provider-factory.js";
import { QwenProvider } from "./qwen-provider.js";
import { SeededModelProvider } from "./seeded-provider.js";

describe("createModelProvider", () => {
  it("returns mock provider by default", () => {
    const resolved = createModelProvider({ kind: "mock" });

    expect(resolved.kind).toBe("mock");
    expect(resolved.model).toBe("mock-reviewer");
    expect(resolved.models).toEqual({
      planner: "mock-reviewer",
      reviewer: "mock-reviewer",
      referee: "deterministic-referee"
    });
    expect(resolved.provider).toBeInstanceOf(MockModelProvider);
  });

  it("returns qwen provider when requested", () => {
    const resolved = createModelProvider({ kind: "qwen" });

    expect(resolved.kind).toBe("qwen");
    expect(resolved.model).toBe("qwen-turbo");
    expect(resolved.models).toEqual({
      planner: "qwen-turbo",
      reviewer: "qwen-turbo",
      referee: "qwen-turbo"
    });
    expect(resolved.provider).toBeInstanceOf(QwenProvider);
  });

  it("returns seeded provider when requested", () => {
    const resolved = createModelProvider({ kind: "seeded" });

    expect(resolved.kind).toBe("seeded");
    expect(resolved.model).toBe("seeded-reviewer");
    expect(resolved.models).toEqual({
      planner: "seeded-reviewer",
      reviewer: "seeded-reviewer",
      referee: "deterministic-referee"
    });
    expect(resolved.provider).toBeInstanceOf(SeededModelProvider);
  });
});
