import { describe, expect, it } from "vitest";
import {
  parseEslintJson,
  parseGitleaksJson,
  parseSemgrepJson,
  parseTypeScriptDiagnostics
} from "./tool-evidence.js";

describe("tool evidence adapters", () => {
  it("parses TypeScript diagnostics into structured tool signals", () => {
    const signals = parseTypeScriptDiagnostics(
      "apps/api/src/review-runs/review-run-service.ts(91,13): error TS2322: Type 'string' is not assignable to type 'number'."
    );

    expect(signals).toEqual([
      expect.objectContaining({
        source: "typescript",
        kind: "TS2322",
        file: "apps/api/src/review-runs/review-run-service.ts",
        startLine: 91,
        severity: "medium"
      })
    ]);
  });

  it("parses ESLint JSON formatter output", () => {
    const signals = parseEslintJson(
      JSON.stringify([
        {
          filePath: "apps/api/src/github/webhook.ts",
          messages: [
            {
              line: 45,
              ruleId: "no-console",
              severity: 1,
              message: "Unexpected console statement."
            }
          ]
        }
      ])
    );

    expect(signals).toEqual([
      expect.objectContaining({
        source: "eslint",
        kind: "no-console",
        file: "apps/api/src/github/webhook.ts",
        startLine: 45,
        severity: "low"
      })
    ]);
  });

  it("parses Semgrep JSON output", () => {
    const signals = parseSemgrepJson(
      JSON.stringify({
        results: [
          {
            check_id: "typescript.express.security.audit.missing-auth",
            path: "apps/api/src/github/webhook.ts",
            start: { line: 42 },
            end: { line: 48 },
            extra: {
              message: "Missing authentication guard.",
              severity: "ERROR"
            }
          }
        ]
      })
    );

    expect(signals).toEqual([
      expect.objectContaining({
        source: "semgrep",
        kind: "typescript.express.security.audit.missing-auth",
        file: "apps/api/src/github/webhook.ts",
        startLine: 42,
        endLine: 48,
        severity: "high"
      })
    ]);
  });

  it("parses Gitleaks JSON output without exposing the raw secret", () => {
    const signals = parseGitleaksJson(
      JSON.stringify([
        {
          RuleID: "generic-api-key",
          Description: "Generic API key detected.",
          File: "apps/api/src/github/webhook.ts",
          StartLine: 12,
          EndLine: 12,
          Secret: "sk-test-very-sensitive-secret-value"
        }
      ])
    );

    expect(signals).toEqual([
      expect.objectContaining({
        source: "secret-scan",
        kind: "generic-api-key",
        file: "apps/api/src/github/webhook.ts",
        startLine: 12,
        severity: "high"
      })
    ]);
    expect(signals[0]?.evidence.join(" ")).not.toContain("very-sensitive-secret-value");
  });
});
