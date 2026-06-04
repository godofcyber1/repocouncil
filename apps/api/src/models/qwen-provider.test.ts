import { describe, expect, it, vi } from "vitest";
import { parseJsonContent, QwenProvider } from "./qwen-provider.js";

describe("QwenProvider", () => {
  it("calls the OpenAI-compatible chat completions endpoint and parses JSON", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({ ok: true })
              }
            }
          ],
          usage: {
            prompt_tokens: 10,
            completion_tokens: 5
          }
        }),
        { status: 200 }
      )
    );

    const provider = new QwenProvider({
      apiKey: "test-key",
      baseUrl: "https://example.test/compatible-mode/v1/",
      fetchImpl: fetchMock as unknown as typeof fetch
    });

    const result = await provider.generateJson<{ ok: boolean }>({
      model: "qwen-plus",
      schemaName: "TestSchema",
      messages: [{ role: "user", content: "Return JSON." }]
    });

    expect(result.data).toEqual({ ok: true });
    expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
    expect(fetchMock).toHaveBeenCalledOnce();

    const firstCall = fetchMock.mock.calls[0];

    if (!firstCall) {
      throw new Error("Expected fetch to be called.");
    }

    const [url, init] = firstCall as unknown as [string, RequestInit];
    expect(url).toBe("https://example.test/compatible-mode/v1/chat/completions");
    expect(init.headers).toMatchObject({
      Authorization: "Bearer test-key",
      "Content-Type": "application/json"
    });
    expect(JSON.parse(init.body as string)).toMatchObject({
      model: "qwen-plus",
      temperature: 0,
      response_format: { type: "json_object" }
    });
  });

  it("parses JSON wrapped in markdown fences", () => {
    expect(parseJsonContent<{ ok: boolean }>("```json\n{\"ok\":true}\n```")).toEqual({
      ok: true
    });
  });

  it("throws on non-2xx responses", async () => {
    const fetchMock = vi.fn(async () => new Response("bad request", { status: 400 }));

    const provider = new QwenProvider({
      apiKey: "test-key",
      fetchImpl: fetchMock as unknown as typeof fetch
    });

    await expect(
      provider.generateJson({
        model: "qwen-plus",
        schemaName: "TestSchema",
        messages: [{ role: "user", content: "Return JSON." }]
      })
    ).rejects.toThrow("Qwen chat completion failed (400): bad request");
  });
});
