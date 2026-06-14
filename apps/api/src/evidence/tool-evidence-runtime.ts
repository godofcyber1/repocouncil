import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import type { ToolSignal } from "@repocouncil/shared";
import {
  parseEslintJson,
  parseGitleaksJson,
  parseSemgrepJson,
  parseTypeScriptDiagnostics
} from "./tool-evidence.js";

export type ToolEvidenceRunnerInput = {
  command: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
};

export type ToolEvidenceRunnerOutput = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut?: boolean;
};

export type ToolEvidenceRunner = (
  input: ToolEvidenceRunnerInput
) => Promise<ToolEvidenceRunnerOutput>;

export type CollectToolEvidenceOptions = {
  repoRoot: string;
  changedFiles: Array<{ path: string }>;
  timeoutMs?: number;
  runner?: ToolEvidenceRunner;
};

export type ToolEvidenceJobStatus = "skipped" | "passed" | "failed" | "timed_out";

export type ToolEvidenceJobReport = {
  source: ToolSignal["source"];
  scriptName: string;
  commandLabel: string;
  status: ToolEvidenceJobStatus;
  exitCode?: number | null;
  rawSignalCount: number;
  relatedSignalCount: number;
  message: string;
};

export type ToolEvidenceReport = {
  signals: ToolSignal[];
  jobs: ToolEvidenceJobReport[];
};

type PackageJson = {
  scripts?: Record<string, string>;
};

type EvidenceJob = {
  source: ToolSignal["source"];
  scriptName: string;
  commandLabel: string;
};

const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_SIGNALS = 50;

export async function collectToolEvidence(
  options: CollectToolEvidenceOptions
): Promise<ToolSignal[]> {
  const report = await collectToolEvidenceReport(options);

  return report.signals;
}

export async function collectToolEvidenceReport(
  options: CollectToolEvidenceOptions
): Promise<ToolEvidenceReport> {
  const packageJson = await readPackageJson(options.repoRoot);
  const scripts = packageJson.scripts ?? {};
  const jobs = buildEvidenceJobs();
  const runner = options.runner ?? runCommand;
  const changedPaths = new Set(options.changedFiles.map((file) => normalizePath(file.path)));
  const signals: ToolSignal[] = [];
  const jobReports: ToolEvidenceJobReport[] = [];

  for (const job of jobs) {
    if (!scripts[job.scriptName]) {
      jobReports.push(createSkippedJobReport(job));
      continue;
    }

    const output = await runner({
      command: npmCommand(),
      args: ["run", job.scriptName],
      cwd: options.repoRoot,
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    });
    const rawSignals = parseJobOutput(job, output);
    const relatedSignals = rawSignals.filter((signal) => !signal.file || changedPaths.has(signal.file));

    signals.push(...relatedSignals);
    jobReports.push(createCompletedJobReport(job, output, rawSignals.length, relatedSignals.length));
  }

  return {
    signals: signals.slice(0, MAX_SIGNALS),
    jobs: jobReports
  };
}

function buildEvidenceJobs(): EvidenceJob[] {
  return [
    { scriptName: "typecheck", source: "typescript", commandLabel: "npm run typecheck" },
    { scriptName: "lint", source: "eslint", commandLabel: "npm run lint" },
    { scriptName: "test", source: "test", commandLabel: "npm run test" },
    { scriptName: "semgrep", source: "semgrep", commandLabel: "npm run semgrep" },
    { scriptName: "secret-scan", source: "secret-scan", commandLabel: "npm run secret-scan" },
    { scriptName: "gitleaks", source: "secret-scan", commandLabel: "npm run gitleaks" }
  ];
}

function parseJobOutput(
  job: EvidenceJob,
  output: ToolEvidenceRunnerOutput
): ToolSignal[] {
  const combinedOutput = [output.stdout, output.stderr].filter(Boolean).join("\n");

  if (job.source === "typescript") {
    return parseTypeScriptDiagnostics(combinedOutput);
  }

  if (job.source === "eslint") {
    return parseJsonOrFailure(job, output, () => parseEslintJson(combinedOutput));
  }

  if (job.source === "semgrep") {
    return parseJsonOrFailure(job, output, () => parseSemgrepJson(combinedOutput));
  }

  if (job.source === "secret-scan") {
    return parseJsonOrFailure(job, output, () => parseGitleaksJson(combinedOutput));
  }

  if (output.exitCode !== 0 || output.timedOut) {
    return [createFailureSignal(job, output)];
  }

  return [];
}

function parseJsonOrFailure(
  job: EvidenceJob,
  output: ToolEvidenceRunnerOutput,
  parse: () => ToolSignal[]
): ToolSignal[] {
  try {
    const parsed = parse();

    if (parsed.length > 0) {
      return parsed;
    }
  } catch {
    // Fall back to a command-level signal below when the tool failed but did not emit supported JSON.
  }

  if (output.exitCode !== 0 || output.timedOut) {
    return [createFailureSignal(job, output)];
  }

  return [];
}

function createFailureSignal(
  job: EvidenceJob,
  output: ToolEvidenceRunnerOutput
): ToolSignal {
  const message = output.timedOut
    ? `${job.commandLabel} timed out.`
    : `${job.commandLabel} exited with code ${output.exitCode ?? "unknown"}.`;
  const evidence = summarizeOutput([output.stdout, output.stderr].filter(Boolean).join("\n"));

  return {
    id: `${job.source}:${job.scriptName}:command-failure`,
    source: job.source,
    kind: `${job.scriptName}-failed`,
    severity: job.source === "secret-scan" || job.source === "semgrep" ? "high" : "medium",
    message,
    evidence: evidence ? [evidence] : [message],
    command: job.commandLabel
  };
}

function createSkippedJobReport(job: EvidenceJob): ToolEvidenceJobReport {
  return {
    source: job.source,
    scriptName: job.scriptName,
    commandLabel: job.commandLabel,
    status: "skipped",
    rawSignalCount: 0,
    relatedSignalCount: 0,
    message: `${job.commandLabel} was skipped because package.json does not define script "${job.scriptName}".`
  };
}

function createCompletedJobReport(
  job: EvidenceJob,
  output: ToolEvidenceRunnerOutput,
  rawSignalCount: number,
  relatedSignalCount: number
): ToolEvidenceJobReport {
  const status: ToolEvidenceJobStatus = output.timedOut
    ? "timed_out"
    : output.exitCode === 0
      ? "passed"
      : "failed";

  return {
    source: job.source,
    scriptName: job.scriptName,
    commandLabel: job.commandLabel,
    status,
    exitCode: output.exitCode,
    rawSignalCount,
    relatedSignalCount,
    message: summarizeJobMessage(job, output, rawSignalCount, relatedSignalCount)
  };
}

function summarizeJobMessage(
  job: EvidenceJob,
  output: ToolEvidenceRunnerOutput,
  rawSignalCount: number,
  relatedSignalCount: number
): string {
  if (output.timedOut) {
    return `${job.commandLabel} timed out after producing ${rawSignalCount} signal(s), ${relatedSignalCount} related to changed files.`;
  }

  if (output.exitCode !== 0) {
    return `${job.commandLabel} failed with exit code ${output.exitCode ?? "unknown"} and produced ${rawSignalCount} signal(s), ${relatedSignalCount} related to changed files.`;
  }

  return `${job.commandLabel} passed and produced ${rawSignalCount} signal(s), ${relatedSignalCount} related to changed files.`;
}

async function readPackageJson(repoRoot: string): Promise<PackageJson> {
  const content = await fs.readFile(path.join(repoRoot, "package.json"), "utf8");

  return JSON.parse(content) as PackageJson;
}

function runCommand(input: ToolEvidenceRunnerInput): Promise<ToolEvidenceRunnerOutput> {
  return new Promise((resolve) => {
    const child = spawn(input.command, input.args, {
      cwd: input.cwd,
      windowsHide: true
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, input.timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({
        exitCode: null,
        stdout: "",
        stderr: error.message,
        timedOut
      });
    });
    child.on("close", (exitCode) => {
      clearTimeout(timer);
      resolve({
        exitCode,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        timedOut
      });
    });
  });
}

function summarizeOutput(output: string): string {
  const compact = output.replace(/\s+/g, " ").trim();

  return compact.length > 500 ? `${compact.slice(0, 500)}...` : compact;
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/");
}

function npmCommand(): string {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}
