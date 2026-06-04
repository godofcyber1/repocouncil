import { config } from "../config/env.js";
import type { ModelJsonRequest, ModelJsonResponse, ModelProvider } from "./model-provider.js";

export class QwenProvider implements ModelProvider {
  async generateJson<T>(_request: ModelJsonRequest): Promise<ModelJsonResponse<T>> {
    if (!config.qwenApiKey) {
      throw new Error("QWEN_API_KEY is required before model calls can run.");
    }

    throw new Error("QwenProvider.generateJson is not implemented yet.");
  }
}
