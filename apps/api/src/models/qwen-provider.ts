import { config } from "../config/env.js";
import type { ModelJsonRequest, ModelJsonResponse, ModelProvider } from "./model-provider.js";

type QwenProviderOptions = {
  apiKey?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
};

type ChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
};

const DEFAULT_QWEN_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1";

export class QwenProvider implements ModelProvider {
  private readonly apiKey: string | undefined;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: QwenProviderOptions = {}) {
    this.apiKey = options.apiKey ?? config.qwenApiKey;
    this.baseUrl = stripTrailingSlash(
      options.baseUrl ?? config.qwenBaseUrl ?? DEFAULT_QWEN_BASE_URL
    );
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async generateJson<T>(request: ModelJsonRequest): Promise<ModelJsonResponse<T>> {
    if (!this.apiKey) {
      throw new Error("QWEN_API_KEY is required before model calls can run.");
    }

    const response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: request.model,
        messages: [
          ...request.messages,
          {
            role: "system",
            content: `Return only valid JSON for schema ${request.schemaName}. Do not wrap it in markdown.`
          }
        ],
        temperature: request.temperature ?? 0,
        response_format: {
          type: "json_object"
        }
      })
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Qwen chat completion failed (${response.status}): ${body}`);
    }

    const payload = (await response.json()) as ChatCompletionResponse;
    const rawText = payload.choices?.[0]?.message?.content;

    if (!rawText) {
      throw new Error("Qwen chat completion did not return message content.");
    }

    const usage: ModelJsonResponse<T>["usage"] = {};

    if (payload.usage?.prompt_tokens !== undefined) {
      usage.inputTokens = payload.usage.prompt_tokens;
    }

    if (payload.usage?.completion_tokens !== undefined) {
      usage.outputTokens = payload.usage.completion_tokens;
    }

    return {
      data: parseJsonContent<T>(rawText),
      rawText,
      usage
    };
  }
}

export function parseJsonContent<T>(content: string): T {
  const trimmed = content.trim();
  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  return JSON.parse(withoutFence) as T;
}

function stripTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}
