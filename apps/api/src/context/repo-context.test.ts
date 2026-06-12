import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { discoverRepositoryContext } from "./repo-context.js";

describe("discoverRepositoryContext", () => {
  it("discovers repository rules, package context, and Prisma schema for changed files", async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "repocouncil-context-"));
    await writeFile(repoRoot, "AGENTS.md", "All API inputs must be validated with Zod.");
    await writeFile(repoRoot, "CLAUDE.md", "Prefer evidence-backed review comments.");
    await writeFile(repoRoot, ".cursorrules", "Use Vitest for tests.");
    await writeFile(repoRoot, "package.json", JSON.stringify({ scripts: { test: "vitest run" } }));
    await writeFile(
      repoRoot,
      "apps/api/package.json",
      JSON.stringify({ scripts: { typecheck: "tsc -p tsconfig.json --noEmit" } })
    );
    await writeFile(repoRoot, "apps/api/prisma/schema.prisma", "model ReviewRun { id String @id }");
    await writeFile(repoRoot, "apps/api/src/server.ts", "export const ok = true;");

    const contexts = await discoverRepositoryContext({
      repoRoot,
      changedFiles: [{ path: "apps/api/src/server.ts" }]
    });

    expect(contexts.map((context) => context.path)).toEqual(
      expect.arrayContaining([
        ".cursorrules",
        "AGENTS.md",
        "CLAUDE.md",
        "apps/api/package.json",
        "apps/api/prisma/schema.prisma",
        "package.json"
      ])
    );
    expect(contexts.find((context) => context.path === "AGENTS.md")).toEqual(
      expect.objectContaining({
        role: "guideline",
        content: "All API inputs must be validated with Zod."
      })
    );
    expect(contexts.find((context) => context.path === "apps/api/prisma/schema.prisma")).toEqual(
      expect.objectContaining({
        role: "schema"
      })
    );
  });

  it("does not read paths outside the repository root", async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "repocouncil-context-"));
    await writeFile(repoRoot, "package.json", "{}");

    const contexts = await discoverRepositoryContext({
      repoRoot,
      changedFiles: [{ path: "../outside.ts" }]
    });

    expect(contexts.map((context) => context.path)).toEqual(["package.json"]);
  });
});

async function writeFile(repoRoot: string, relativePath: string, content: string) {
  const absolutePath = path.join(repoRoot, relativePath);

  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, content, "utf8");
}
