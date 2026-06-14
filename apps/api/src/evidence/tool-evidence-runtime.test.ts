import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  collectToolEvidence,
  collectToolEvidenceReport,
  type ToolEvidenceRunner
} from "./tool-evidence-runtime.js";

describe("collectToolEvidence", () => {
  it("runs configured package scripts and keeps signals related to changed files", async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "repocouncil-tools-"));
    const calls: string[] = [];
    const runner: ToolEvidenceRunner = async (input) => {
      calls.push(input.args.join(" "));

      if (input.args.includes("typecheck")) {
        return {
          exitCode: 1,
          stdout:
            "apps/api/src/review-runs/review-run-service.ts(91,13): error TS2322: Type 'string' is not assignable to type 'number'.",
          stderr: ""
        };
      }

      return {
        exitCode: 0,
        stdout: "[]",
        stderr: ""
      };
    };

    await fs.writeFile(
      path.join(repoRoot, "package.json"),
      JSON.stringify({
        scripts: {
          typecheck: "tsc -p tsconfig.json --noEmit",
          lint: "eslint . --format json"
        }
      }),
      "utf8"
    );

    const signals = await collectToolEvidence({
      repoRoot,
      changedFiles: [{ path: "apps/api/src/review-runs/review-run-service.ts" }],
      runner
    });

    expect(calls).toEqual(["run typecheck", "run lint"]);
    expect(signals).toEqual([
      expect.objectContaining({
        source: "typescript",
        kind: "TS2322",
        file: "apps/api/src/review-runs/review-run-service.ts"
      })
    ]);
  });

  it("reports configured, skipped, and unrelated tool evidence jobs", async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "repocouncil-tool-report-"));
    const runner: ToolEvidenceRunner = async (input) => {
      if (input.args.includes("typecheck")) {
        return {
          exitCode: 1,
          stdout: [
            "src/changed.ts(12,3): error TS2322: Type 'string' is not assignable to type 'number'.",
            "src/unrelated.ts(4,1): error TS2552: Cannot find name 'missing'."
          ].join("\n"),
          stderr: ""
        };
      }

      return {
        exitCode: 0,
        stdout: "[]",
        stderr: ""
      };
    };

    await fs.writeFile(
      path.join(repoRoot, "package.json"),
      JSON.stringify({
        scripts: {
          typecheck: "tsc -p tsconfig.json --noEmit",
          lint: "eslint . --format json"
        }
      }),
      "utf8"
    );

    const report = await collectToolEvidenceReport({
      repoRoot,
      changedFiles: [{ path: "src/changed.ts" }],
      runner
    });

    expect(report.signals).toHaveLength(1);
    expect(report.signals[0]).toEqual(
      expect.objectContaining({
        file: "src/changed.ts",
        kind: "TS2322"
      })
    );
    expect(report.jobs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          scriptName: "typecheck",
          status: "failed",
          rawSignalCount: 2,
          relatedSignalCount: 1
        }),
        expect.objectContaining({
          scriptName: "lint",
          status: "passed",
          rawSignalCount: 0,
          relatedSignalCount: 0
        }),
        expect.objectContaining({
          scriptName: "semgrep",
          status: "skipped"
        }),
        expect.objectContaining({
          scriptName: "gitleaks",
          status: "skipped"
        })
      ])
    );
  });
});
