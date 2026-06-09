import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ReviewFindingList, ReviewPlan } from "@repocouncil/shared";
import { evaluateRepoCouncil } from "./eval-runner.js";
import { loadEvalInputFromFixtures } from "./eval-fixtures.js";
import type { ModelJsonRequest, ModelJsonResponse, ModelProvider } from "../models/model-provider.js";

describe("loadEvalInputFromFixtures", () => {
  it("runs review graph over fixed PR fixtures and preserves structured ground truth", async () => {
    const fixturesDir = await createFixtureDir();
    const evalInput = await loadEvalInputFromFixtures({
      fixturesDir,
      stage: "stage-1",
      mode: "council",
      modelProvider: new SeededFixtureProvider(),
      model: "seeded-fixture"
    });

    expect(evalInput.groundTruth).toHaveLength(1);
    expect(evalInput.groundTruth[0]).toEqual(
      expect.objectContaining({
        id: "gt-001",
        title: "Webhook signature validation fails open",
        file: "apps/api/src/github/webhook.ts",
        lineRange: [42, 48],
        acceptableSeverities: ["high", "critical"]
      })
    );
    expect(evalInput.candidateFindings).toHaveLength(3);
    expect(evalInput.finalFindings).toHaveLength(1);

    const result = evaluateRepoCouncil(evalInput);

    expect(result).toEqual(
      expect.objectContaining({
        fixture_count: 1,
        candidate_findings: 3,
        final_findings: 1,
        matched_findings: 1,
        precision: 1,
        recall: 1,
        noise_rate: 0
      })
    );
  });
});

async function createFixtureDir(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "repocouncil-eval-"));
  const fixtureDir = path.join(root, "01-security-webhook-fail-open");
  await fs.mkdir(fixtureDir, { recursive: true });
  await Promise.all([
    fs.writeFile(
      path.join(fixtureDir, "pr.json"),
      JSON.stringify({
        repository: "godofcyber1/repocouncil-fixtures",
        pullNumber: 101,
        headSha: "fixture-sha"
      }),
      "utf8"
    ),
    fs.writeFile(
      path.join(fixtureDir, "changed-files.json"),
      JSON.stringify([
        {
          path: "apps/api/src/github/webhook.ts",
          patch:
            "@@ -42,7 +42,7 @@\n-    return new Response(\"invalid signature\", { status: 401 });\n+    console.warn(\"invalid signature\");"
        }
      ]),
      "utf8"
    ),
    fs.writeFile(
      path.join(fixtureDir, "ground-truth.json"),
      JSON.stringify({
        id: "gt-001",
        title: "Webhook signature validation fails open",
        category: "security",
        severity: "high",
        file: "apps/api/src/github/webhook.ts",
        lineRange: [42, 48],
        expectedSignals: ["signature", "invalid signature", "fail closed", "401", "continue"],
        acceptableCategories: ["security"],
        acceptableSeverities: ["high", "critical"],
        explanation:
          "Invalid GitHub webhook signatures should stop processing. This PR logs the failure but still persists the webhook."
      }),
      "utf8"
    )
  ]);

  return root;
}

class SeededFixtureProvider implements ModelProvider {
  async generateJson<T>(request: ModelJsonRequest): Promise<ModelJsonResponse<T>> {
    if (request.schemaName === "ReviewPlan") {
      const plan: ReviewPlan = {
        planId: "plan_fixture_001",
        tasks: [
          {
            id: "task_security_001",
            agent: "security_reviewer",
            files: ["apps/api/src/github/webhook.ts"],
            goal: "Find high-confidence webhook authentication issues."
          }
        ],
        humanGateRequired: false
      };

      return {
        data: plan as T,
        rawText: JSON.stringify(plan)
      };
    }

    const findings: ReviewFindingList = {
      findings: [
        {
          id: `finding_${request.messages[0]?.content.includes("Security") ? "security" : "other"}`,
          title: "Webhook signature validation can continue after invalid signature",
          body:
            "The changed code logs an invalid signature instead of failing closed with a 401 response, so processing can continue.",
          file: "apps/api/src/github/webhook.ts",
          startLine: 42,
          endLine: 48,
          severity: "high",
          confidence: 0.92,
          category: "security",
          evidence: ["invalid signature no longer returns 401", "webhook processing can continue"],
          suggestedPatch: "Return 401 immediately when signature verification fails."
        }
      ]
    };

    return {
      data: findings as T,
      rawText: JSON.stringify(findings)
    };
  }
}
