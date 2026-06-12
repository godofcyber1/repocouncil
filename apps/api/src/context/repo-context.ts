import fs from "node:fs/promises";
import path from "node:path";
import type { RepositoryFileContext } from "@repocouncil/shared";

export type DiscoverRepositoryContextOptions = {
  repoRoot: string;
  changedFiles: Array<{ path: string }>;
  maxFileBytes?: number;
};

const GUIDELINE_FILES = [
  "AGENTS.md",
  "CLAUDE.md",
  ".cursorrules",
  ".github/copilot-instructions.md"
];

const DEFAULT_MAX_FILE_BYTES = 12_000;

export async function discoverRepositoryContext(
  options: DiscoverRepositoryContextOptions
): Promise<RepositoryFileContext[]> {
  const repoRoot = path.resolve(options.repoRoot);
  const maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  const changedPaths = options.changedFiles.map((file) => normalizeRepoPath(file.path));
  const candidates = new Map<string, RepositoryFileContext["role"]>();

  for (const guideline of GUIDELINE_FILES) {
    candidates.set(guideline, "guideline");
  }

  for (const packageJsonPath of packageJsonCandidates(changedPaths)) {
    candidates.set(packageJsonPath, "config");
  }

  for (const prismaSchemaPath of await prismaSchemaCandidates(repoRoot, changedPaths)) {
    candidates.set(prismaSchemaPath, "schema");
  }

  const contexts: RepositoryFileContext[] = [];

  for (const [relativePath, role] of candidates) {
    const context = await readContextFile(repoRoot, relativePath, role, maxFileBytes);

    if (context) {
      contexts.push(context);
    }
  }

  return contexts.sort((left, right) => left.path.localeCompare(right.path));
}

function packageJsonCandidates(changedPaths: string[]): string[] {
  const candidates = new Set<string>(["package.json"]);

  for (const changedPath of changedPaths) {
    if (!isTypeScriptOrJavaScriptPath(changedPath) && !changedPath.endsWith("package.json")) {
      continue;
    }

    let dir = path.posix.dirname(changedPath);

    while (dir && dir !== ".") {
      candidates.add(path.posix.join(dir, "package.json"));
      dir = path.posix.dirname(dir);
    }
  }

  return [...candidates];
}

async function prismaSchemaCandidates(repoRoot: string, changedPaths: string[]): Promise<string[]> {
  const shouldIncludePrisma =
    changedPaths.some((changedPath) => changedPath.includes("/prisma/") || changedPath.endsWith(".prisma")) ||
    changedPaths.some((changedPath) => changedPath.endsWith(".ts") || changedPath.endsWith(".tsx"));

  if (!shouldIncludePrisma) {
    return [];
  }

  return findFiles(repoRoot, "schema.prisma", 4);
}

async function findFiles(root: string, fileName: string, maxDepth: number): Promise<string[]> {
  const found: string[] = [];

  await walk(root, "", 0);

  return found;

  async function walk(absDir: string, relativeDir: string, depth: number): Promise<void> {
    if (depth > maxDepth || shouldSkipDir(relativeDir)) {
      return;
    }

    try {
      const entries = await fs.readdir(absDir, { withFileTypes: true });

      for (const entry of entries) {
        const relativePath = normalizeRepoPath(path.posix.join(relativeDir, entry.name));
        const absolutePath = path.join(absDir, entry.name);

        if (entry.isFile() && entry.name === fileName) {
          found.push(relativePath);
        } else if (entry.isDirectory()) {
          await walk(absolutePath, relativePath, depth + 1);
        }
      }
    } catch {
      return;
    }
  }
}

async function readContextFile(
  repoRoot: string,
  relativePath: string,
  role: RepositoryFileContext["role"],
  maxFileBytes: number
): Promise<RepositoryFileContext | null> {
  const normalizedPath = normalizeRepoPath(relativePath);
  const absolutePath = path.resolve(repoRoot, normalizedPath);

  if (!isInsideRoot(repoRoot, absolutePath)) {
    return null;
  }

  try {
    const stat = await fs.stat(absolutePath);

    if (!stat.isFile() || stat.size > maxFileBytes) {
      return null;
    }

    const content = await fs.readFile(absolutePath, "utf8");

    return {
      path: normalizedPath,
      role,
      content,
      summary: summarizeContext(normalizedPath, role, content)
    };
  } catch (error) {
    if (error instanceof Error && (error as { code?: string }).code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

function summarizeContext(pathName: string, role: RepositoryFileContext["role"], content: string): string {
  const firstLine = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);

  return `${role} context from ${pathName}${firstLine ? `: ${firstLine}` : ""}`;
}

function isTypeScriptOrJavaScriptPath(filePath: string): boolean {
  return /\.(ts|tsx|js|jsx|mts|cts|mjs|cjs)$/.test(filePath);
}

function normalizeRepoPath(filePath: string): string {
  return filePath.replace(/\\/g, "/").replace(/^\/+/, "");
}

function shouldSkipDir(relativeDir: string): boolean {
  return /(^|\/)(node_modules|\.git|dist|\.next|coverage)(\/|$)/.test(relativeDir);
}

function isInsideRoot(repoRoot: string, absolutePath: string): boolean {
  const relative = path.relative(repoRoot, absolutePath);

  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
