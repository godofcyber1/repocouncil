import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  collectToolEvidence,
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
});
