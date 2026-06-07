import { config } from "../config/env.js";
import { MockModelProvider } from "./mock-provider.js";
import type { ModelProvider } from "./model-provider.js";
import { QwenProvider } from "./qwen-provider.js";

export type ModelProviderKind = "mock" | "qwen";

export type ResolvedModelProvider = {
  kind: ModelProviderKind;
  model: string;
  provider: ModelProvider;
};

export type CreateModelProviderOptions = {
  kind?: ModelProviderKind;
};

export function createModelProvider(
  options: CreateModelProviderOptions = {}
): ResolvedModelProvider {
  const kind = options.kind ?? config.modelProvider;

  if (kind === "qwen") {
    return {
      kind,
      model: config.qwenModelReviewer ?? "qwen-plus",
      provider: new QwenProvider()
    };
  }

  return {
    kind: "mock",
    model: "mock-reviewer",
    provider: new MockModelProvider()
  };
}
