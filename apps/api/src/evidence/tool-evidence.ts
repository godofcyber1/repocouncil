import type { ToolSignal } from "@repocouncil/shared";

type EslintJsonResult = {
  filePath?: string;
  messages?: Array<{
    line?: number;
    endLine?: number;
    ruleId?: string | null;
    severity?: number;
    message?: string;
  }>;
};

type SemgrepJsonResult = {
  results?: Array<{
    check_id?: string;
    path?: string;
    start?: { line?: number };
    end?: { line?: number };
    extra?: {
      message?: string;
      severity?: string;
    };
  }>;
};

type GitleaksJsonFinding = {
  RuleID?: string;
  Description?: string;
  File?: string;
  StartLine?: number;
  EndLine?: number;
  Secret?: string;
  Match?: string;
};

export function parseTypeScriptDiagnostics(output: string): ToolSignal[] {
  const signals: ToolSignal[] = [];
  const pattern = /^(.+?)\((\d+),(\d+)\):\s+error\s+(TS\d+):\s+(.+)$/gm;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(output)) !== null) {
    const [, file, line, , code, message] = match;

    if (!file || !line || !code || !message) {
      continue;
    }

    signals.push({
      id: `typescript:${file}:${line}:${code}`,
      source: "typescript",
      kind: code,
      file: normalizePath(file),
      startLine: Number(line),
      severity: "medium",
      message,
      evidence: [`${code}: ${message}`],
      command: "tsc --noEmit"
    });
  }

  return signals;
}

export function parseEslintJson(output: string): ToolSignal[] {
  const parsed = JSON.parse(output) as EslintJsonResult[];

  return parsed.flatMap((result) =>
    (result.messages ?? []).flatMap((message, index) => {
      if (!result.filePath || !message.message) {
        return [];
      }

      return [
        {
          id: `eslint:${normalizePath(result.filePath)}:${message.line ?? 1}:${message.ruleId ?? index}`,
          source: "eslint",
          kind: message.ruleId ?? "eslint",
          file: normalizePath(result.filePath),
          ...(message.line ? { startLine: message.line } : {}),
          ...(message.endLine ? { endLine: message.endLine } : {}),
          severity: message.severity === 2 ? "medium" : "low",
          message: message.message,
          evidence: [message.message],
          command: "eslint --format json"
        } satisfies ToolSignal
      ];
    })
  );
}

export function parseSemgrepJson(output: string): ToolSignal[] {
  const parsed = JSON.parse(output) as SemgrepJsonResult;

  return (parsed.results ?? []).flatMap((result, index) => {
    const path = result.path;
    const message = result.extra?.message;

    if (!path || !message) {
      return [];
    }

    const line = result.start?.line;

    return [
      {
        id: `semgrep:${normalizePath(path)}:${line ?? 1}:${result.check_id ?? index}`,
        source: "semgrep",
        kind: result.check_id ?? "semgrep",
        file: normalizePath(path),
        ...(line ? { startLine: line } : {}),
        ...(result.end?.line ? { endLine: result.end.line } : {}),
        severity: mapSemgrepSeverity(result.extra?.severity),
        message,
        evidence: [message],
        command: "semgrep --json"
      } satisfies ToolSignal
    ];
  });
}

export function parseGitleaksJson(output: string): ToolSignal[] {
  const parsed = JSON.parse(output) as GitleaksJsonFinding[];

  return parsed.flatMap((finding, index) => {
    const file = finding.File;
    const message = finding.Description ?? finding.RuleID ?? "Potential secret detected.";

    if (!file) {
      return [];
    }

    return [
      {
        id: `secret-scan:${normalizePath(file)}:${finding.StartLine ?? 1}:${finding.RuleID ?? index}`,
        source: "secret-scan",
        kind: finding.RuleID ?? "secret",
        file: normalizePath(file),
        ...(finding.StartLine ? { startLine: finding.StartLine } : {}),
        ...(finding.EndLine ? { endLine: finding.EndLine } : {}),
        severity: "high",
        message,
        evidence: [redactSecretEvidence(finding.Match ?? finding.Secret ?? message)],
        command: "gitleaks detect --report-format json"
      } satisfies ToolSignal
    ];
  });
}

function mapSemgrepSeverity(value: string | undefined): ToolSignal["severity"] {
  if (value === "ERROR") {
    return "high";
  }

  if (value === "WARNING") {
    return "medium";
  }

  return "low";
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/");
}

function redactSecretEvidence(value: string): string {
  if (value.length <= 12) {
    return "[redacted secret evidence]";
  }

  return `${value.slice(0, 6)}...[redacted]`;
}
