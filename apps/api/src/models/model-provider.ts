export type ModelMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type ModelJsonRequest = {
  model: string;
  messages: ModelMessage[];
  schemaName: string;
  temperature?: number;
};

export type ModelJsonResponse<T> = {
  data: T;
  rawText: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
  };
};

export interface ModelProvider {
  generateJson<T>(request: ModelJsonRequest): Promise<ModelJsonResponse<T>>;
}
