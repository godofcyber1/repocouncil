import type { EvalFinding, EvalGroundTruthIssue } from "./eval-runner.js";

export type FindingMatchResult = {
  strict: boolean;
  loose: boolean;
  score: number;
  reasons: string[];
};

export type EvalMatch = {
  issue: EvalGroundTruthIssue;
  finding: EvalFinding;
  result: FindingMatchResult;
};

const relatedCategories: Record<string, string[]> = {
  security: ["security", "testing"],
  correctness: ["correctness", "quality", "testing"],
  testing: ["testing", "security", "correctness", "quality"],
  quality: ["quality", "correctness", "testing"],
  maintainability: ["maintainability", "quality", "correctness"]
};

export function matchFindingToGroundTruth(
  finding: EvalFinding,
  issue: EvalGroundTruthIssue
): FindingMatchResult {
  const reasons: string[] = [];
  const sameFixture = sameFixtureScope(finding.id, issue.id);
  const sameFile = finding.file === issue.file;
  const acceptableCategories = acceptedCategories(issue);
  const acceptableSeverities = acceptedSeverities(issue);
  const categoryAccepted = acceptableCategories.includes(finding.category);
  const categoryRelated = relatedCategories[issue.category]?.includes(finding.category) ?? false;
  const severityAccepted = acceptableSeverities.includes(finding.severity);
  const lineMatched = lineMatches(finding, issue);
  const signalHits = matchedSignals(finding, issue.expectedSignals);
  const requiredSignalHits = Math.min(2, issue.expectedSignals.length);
  const usefulSignalHits = signalHits >= requiredSignalHits;
  const suggestedTestHit = Boolean(finding.suggestedTests) && signalHits >= requiredSignalHits;

  if (sameFile) {
    reasons.push("same file");
  }
  if (lineMatched) {
    reasons.push("line overlaps or is within 5 lines");
  }
  if (categoryAccepted) {
    reasons.push("category accepted");
  } else if (categoryRelated) {
    reasons.push("category related");
  }
  if (severityAccepted) {
    reasons.push("severity accepted");
  }
  if (signalHits > 0) {
    reasons.push(`${signalHits} expected signal(s) matched`);
  }
  if (suggestedTestHit) {
    reasons.push("suggested tests cover expected signals");
  }

  const strict =
    sameFixture && sameFile && lineMatched && categoryAccepted && severityAccepted && usefulSignalHits;
  const loose =
    sameFixture &&
    sameFile &&
    (categoryAccepted || categoryRelated) &&
    (usefulSignalHits || suggestedTestHit);

  return {
    strict,
    loose,
    score:
      (sameFile ? 3 : 0) +
      (sameFixture ? 2 : 0) +
      (lineMatched ? 2 : 0) +
      (categoryAccepted ? 2 : categoryRelated ? 1 : 0) +
      (severityAccepted ? 1 : 0) +
      signalHits,
    reasons
  };
}

function sameFixtureScope(findingId: string, issueId: string): boolean {
  const findingFixture = fixturePrefix(findingId);
  const issueFixture = fixturePrefix(issueId);

  return !findingFixture || !issueFixture || findingFixture === issueFixture;
}

function fixturePrefix(id: string): string | undefined {
  const separatorIndex = id.indexOf(":");

  return separatorIndex === -1 ? undefined : id.slice(0, separatorIndex);
}

export function matchGroundTruthToFindings(
  groundTruth: EvalGroundTruthIssue[],
  findings: EvalFinding[],
  mode: "strict" | "loose"
): EvalMatch[] {
  const matches: EvalMatch[] = [];
  const usedFindingIds = new Set<string>();

  for (const issue of groundTruth) {
    const candidates = findings
      .filter((finding) => !usedFindingIds.has(finding.id))
      .map((finding) => ({
        issue,
        finding,
        result: matchFindingToGroundTruth(finding, issue)
      }))
      .filter((match) => (mode === "strict" ? match.result.strict : match.result.loose))
      .sort((left, right) => right.result.score - left.result.score);

    const best = candidates[0];

    if (best) {
      usedFindingIds.add(best.finding.id);
      matches.push(best);
    }
  }

  return matches;
}

export function lineMatches(finding: EvalFinding, issue: EvalGroundTruthIssue): boolean {
  if (!finding.startLine) {
    return false;
  }

  const findingEndLine = finding.endLine ?? finding.startLine;
  const [issueStart, issueEnd] = issue.lineRange;

  return finding.startLine <= issueEnd + 5 && findingEndLine >= issueStart - 5;
}

export function matchedSignals(finding: EvalFinding, expectedSignals: string[]): number {
  const haystack = [
    finding.title,
    finding.body,
    ...finding.evidence,
    finding.suggestedPatch ?? "",
    finding.suggestedTests ?? ""
  ]
    .join(" ")
    .toLowerCase();

  return expectedSignals.filter((signal) => haystack.includes(signal.toLowerCase())).length;
}

function acceptedCategories(issue: EvalGroundTruthIssue): string[] {
  return issue.acceptableCategories.length > 0 ? issue.acceptableCategories : [issue.category];
}

function acceptedSeverities(issue: EvalGroundTruthIssue): EvalGroundTruthIssue["acceptableSeverities"] {
  return issue.acceptableSeverities.length > 0 ? issue.acceptableSeverities : [issue.severity];
}
