import type { RepositoryFileContext } from "@repocouncil/shared";
import type { GitHubClient } from "../github/github-client.js";

export type FetchGitHubRepositoryContextOptions = {
  github: GitHubClient;
  owner: string;
  repo: string;
  installationId: number | null;
  ref: string;
  changedFiles: Array<{ path: string }>;
  maxFileBytes?: number;
};

type ContextCandidate = {
  path: string;
  role: RepositoryFileContext["role"];
};

const GUIDELINE_CANDIDATES: ContextCandidate[] = [
  { path: "AGENTS.md", role: "guideline" },
  { path: "CLAUDE.md", role: "guideline" },
  { path: ".cursorrules", role: "guideline" },
  { path: ".github/copilot-instructions.md", role: "guideline" }
];

const PRISMA_SCHEMA_CANDIDATES: ContextCandidate[] = [
  { path: "schema.prisma", role: "schema" },
  { path: "prisma/schema.prisma", role: "schema" },
  { path: "apps/api/prisma/schema.prisma", role: "schema" }
];

const DEFAULT_MAX_FILE_BYTES = 12_000;

export async function fetchGitHubRepositoryContext(
  options: FetchGitHubRepositoryContextOptions
): Promise<RepositoryFileContext[]> {
  const candidates = buildGitHubContextCandidates(options.changedFiles);
  const contexts: RepositoryFileContext[] = [];
  const maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;

  for (const candidate of candidates) {
    const content = await options.github.getRepositoryFileContent({
      owner: options.owner,
      repo: options.repo,
      installationId: options.installationId,
      path: candidate.path,
      ref: options.ref
    });

    if (!content || Buffer.byteLength(content, "utf8") > maxFileBytes) {
      continue;
    }

    contexts.push({
      path: candidate.path,
      role: candidate.role,
      content,
      summary: summarizeContext(candidate.path, candidate.role, content)
    });
  }

  return contexts.sort((left, right) => left.path.localeCompare(right.path));
}

function buildGitHubContextCandidates(changedFiles: Array<{ path: string }>): ContextCandidate[] {
  const candidates = new Map<string, ContextCandidate>();

  for (const candidate of GUIDELINE_CANDIDATES) {
    candidates.set(candidate.path, candidate);
  }

  for (const path of packageJsonCandidates(changedFiles.map((file) => normalizeRepoPath(file.path)))) {
    candidates.set(path, { path, role: "config" });
  }

  if (shouldIncludePrismaContext(changedFiles.map((file) => normalizeRepoPath(file.path)))) {
    for (const candidate of PRISMA_SCHEMA_CANDIDATES) {
      candidates.set(candidate.path, candidate);
    }
  }

  return [...candidates.values()];
}

function packageJsonCandidates(changedPaths: string[]): string[] {
  const candidates = new Set<string>(["package.json"]);

  for (const changedPath of changedPaths) {
    if (!isTypeScriptOrJavaScriptPath(changedPath) && !changedPath.endsWith("package.json")) {
      continue;
    }

    let dir = dirname(changedPath);

    while (dir && dir !== ".") {
      candidates.add(`${dir}/package.json`);
      dir = dirname(dir);
    }
  }

  return [...candidates];
}

function shouldIncludePrismaContext(changedPaths: string[]): boolean {
  return changedPaths.some(
    (changedPath) =>
      changedPath.includes("/prisma/") ||
      changedPath.endsWith(".prisma") ||
      changedPath.endsWith(".ts") ||
      changedPath.endsWith(".tsx")
  );
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

function dirname(filePath: string): string {
  const index = filePath.lastIndexOf("/");

  return index === -1 ? "." : filePath.slice(0, index);
}
