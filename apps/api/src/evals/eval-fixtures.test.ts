import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { evaluateRepoCouncil } from "./eval-runner.js";
import { loadBareEvalInputFromFixtures, loadEvalInputFromFixtures } from "./eval-fixtures.js";
import { SeededModelProvider } from "../models/seeded-provider.js";

describe("loadEvalInputFromFixtures", () => {
  it("runs review graph over fixed PR fixtures and preserves structured ground truth", async () => {
    const fixturesDir = await createFixtureDir();
    const evalInput = await loadEvalInputFromFixtures({
      fixturesDir,
      stage: "stage-1",
      mode: "council",
      modelProvider: new SeededModelProvider(),
      model: "seeded-reviewer"
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
    expect(evalInput.candidateFindings).toHaveLength(1);
    expect(evalInput.finalFindings).toHaveLength(1);
    expect(evalInput.finalFindings[0]?.evidence).toEqual(
      expect.arrayContaining([
        "Repository rule requires webhook authentication failures to fail closed."
      ])
    );

    const result = evaluateRepoCouncil(evalInput);

    expect(result).toEqual(
      expect.objectContaining({
        fixture_count: 1,
        candidate_findings: 1,
        final_findings: 1,
        matched_findings: 1,
        precision: 1,
        recall: 1,
        noise_rate: 0
      })
    );
  });

  it("runs bare model review over fixtures without council orchestration", async () => {
    const fixturesDir = await createFixtureDir();
    const evalInput = await loadBareEvalInputFromFixtures({
      fixturesDir,
      stage: "ablation-bare",
      experimentKind: "ablation",
      variant: "bare-model",
      enabledCapabilities: ["raw-model-review"],
      disabledCapabilities: ["schema-orchestration", "council", "deterministic-referee"],
      modelProvider: new SeededModelProvider(),
      model: "seeded-reviewer"
    });

    expect(evalInput.mode).toBe("bare");
    expect(evalInput.variant).toBe("bare-model");
    expect(evalInput.groundTruth).toHaveLength(1);
    expect(evalInput.candidateFindings).toEqual(evalInput.finalFindings);

    const result = evaluateRepoCouncil(evalInput);

    expect(result).toEqual(
      expect.objectContaining({
        mode: "bare",
        experiment_kind: "ablation",
        variant: "bare-model",
        fixture_count: 1
      })
    );
  });

  it("can discover repository context from a repository root during fixture eval", async () => {
    const fixturesDir = await createFixtureDir({ includeRepositoryFiles: false });
    const repositoryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "repocouncil-repo-root-"));
    await writeFile(
      repositoryRoot,
      "AGENTS.md",
      "Webhook authentication failures must fail closed before persistence."
    );
    const evalInput = await loadEvalInputFromFixtures({
      fixturesDir,
      stage: "stage-context",
      mode: "council",
      repositoryRoot,
      modelProvider: new SeededModelProvider(),
      model: "seeded-reviewer"
    });
    const result = evaluateRepoCouncil(evalInput);

    expect(evalInput.finalFindings).toHaveLength(1);
    expect(result.matched_findings).toBe(1);
  });
});

async function createFixtureDir(
  options: { includeRepositoryFiles?: boolean } = {}
): Promise<string> {
  const includeRepositoryFiles = options.includeRepositoryFiles ?? true;
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "repocouncil-eval-"));
  const fixtureDir = path.join(root, "01-security-webhook-fail-open");
  await fs.mkdir(fixtureDir, { recursive: true });
  const writes = [
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
      path.join(fixtureDir, "tool-signals.json"),
      JSON.stringify([
        {
          id: "semgrep:apps/api/src/github/webhook.ts:42:missing-fail-closed",
          source: "semgrep",
          kind: "missing-fail-closed",
          file: "apps/api/src/github/webhook.ts",
          startLine: 42,
          endLine: 48,
          severity: "high",
          message: "Invalid webhook signatures should stop request processing.",
          evidence: ["Semgrep flagged missing fail-closed branch after signature verification."],
          command: "semgrep --json"
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
  ];

  if (includeRepositoryFiles) {
    writes.push(
      fs.writeFile(
        path.join(fixtureDir, "repository-files.json"),
        JSON.stringify([
          {
            path: "AGENTS.md",
            role: "guideline",
            summary: "Webhook authentication failures must fail closed before persistence."
          }
        ]),
        "utf8"
      )
    );
  }

  await Promise.all(writes);

  return root;
}

async function writeFile(repoRoot: string, relativePath: string, content: string) {
  const absolutePath = path.join(repoRoot, relativePath);

  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, content, "utf8");
}
