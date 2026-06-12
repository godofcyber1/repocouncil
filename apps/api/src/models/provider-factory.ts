import { config } from "../config/env.js";
import { MockModelProvider } from "./mock-provider.js";
import type { ModelProvider } from "./model-provider.js";
import { QwenProvider } from "./qwen-provider.js";
import { SeededModelProvider } from "./seeded-provider.js";

export type ModelProviderKind = "mock" | "qwen" | "seeded";

export type ResolvedModelProvider = {
  kind: ModelProviderKind;
  model: string;
  models: {
    planner: string;
    reviewer: string;
    referee: string;
  };
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
    const reviewerModel = config.qwenModelReviewer ?? "qwen-turbo";

    return {
      kind,
      model: reviewerModel,
      models: {
        planner: config.qwenModelPlanner ?? reviewerModel,
        reviewer: reviewerModel,
        referee: config.qwenModelReferee ?? reviewerModel
      },
      provider: new QwenProvider()
    };
  }

  if (kind === "seeded") {
    return {
      kind,
      model: "seeded-reviewer",
      models: {
        planner: "seeded-reviewer",
        reviewer: "seeded-reviewer",
        referee: "deterministic-referee"
      },
      provider: new SeededModelProvider()
    };
  }

  return {
    kind: "mock",
    model: "mock-reviewer",
    models: {
      planner: "mock-reviewer",
      reviewer: "mock-reviewer",
      referee: "deterministic-referee"
    },
    provider: new MockModelProvider()
  };
}
