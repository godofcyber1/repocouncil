import type {
  RefereeDecision,
  RefereeCandidateDecision,
  ReviewFinding,
  ReviewFindingCandidate,
  ReviewerKind
} from "@repocouncil/shared";

export type RefereeResult = {
  findings: ReviewFinding[];
  decision: RefereeDecision;
};

const MIN_PUBLICATION_SCORE = 25;
const DUPLICATE_PENALTY = 5;

const SEVERITY_WEIGHT: Record<ReviewFinding["severity"], number> = {
  critical: 50,
  high: 40,
  medium: 30,
  low: 20,
  info: 10
};

export function scoreFindingCandidate(candidate: ReviewFindingCandidate): number {
  return (
    SEVERITY_WEIGHT[candidate.severity] +
    candidate.confidence * 10 +
    candidate.evidence.length * 2 +
    (candidate.startLine ? 3 : 0) +
    specialtyWeight(candidate.reviewer, candidate.category) +
    (candidate.suggestedPatch ? 2 : 0) +
    (candidate.suggestedTests ? 2 : 0) -
    vagueFindingPenalty(candidate)
  );
}

export function runDeterministicReferee(
  candidates: ReviewFindingCandidate[]
): RefereeResult {
  const groups = groupCandidates(candidates);
  const findings: ReviewFinding[] = [];
  const decisions: RefereeDecision["decisions"] = [];

  for (const group of groups.values()) {
    const ranked = [...group].sort((left, right) => scoreFindingCandidate(right) - scoreFindingCandidate(left));
    const primary = ranked[0];

    if (!primary) {
      continue;
    }

    const primaryScore = scoreFindingCandidate(primary);

    if (primaryScore < MIN_PUBLICATION_SCORE) {
      for (const candidate of ranked) {
        decisions.push(createDecision(candidate, "rejected", scoreFindingCandidate(candidate), "Candidate score was below publication threshold."));
      }
      continue;
    }

    const mergedFinding = mergeGroup(primary, ranked);
    findings.push(mergedFinding);
    decisions.push(createDecision(primary, "accepted", primaryScore, "Highest-scoring candidate in duplicate group."));

    for (const candidate of ranked.slice(1)) {
      decisions.push(
        createDecision(
          candidate,
          "merged",
          scoreFindingCandidate(candidate) - DUPLICATE_PENALTY,
          "Merged into higher-scoring duplicate candidate.",
          primary.id
        )
      );
    }
  }

  return {
    findings,
    decision: {
      candidateCount: candidates.length,
      finalCount: findings.length,
      duplicateGroups: [...groups.values()].filter((group) => group.length > 1).length,
      decisions
    }
  };
}

function groupCandidates(
  candidates: ReviewFindingCandidate[]
): Map<string, ReviewFindingCandidate[]> {
  const groups = new Map<string, ReviewFindingCandidate[]>();

  for (const candidate of candidates) {
    const key = `${candidate.file}:${normalizeLineRange(candidate)}:${candidate.category}`;
    const group = groups.get(key) ?? [];
    group.push(candidate);
    groups.set(key, group);
  }

  return groups;
}

function mergeGroup(
  primary: ReviewFindingCandidate,
  group: ReviewFindingCandidate[]
): ReviewFinding {
  const evidence = dedupeStrings(group.flatMap((candidate) => candidate.evidence));
  const patchCandidate = group.find((candidate) => candidate.suggestedPatch);
  const testsCandidate = group.find((candidate) => candidate.suggestedTests);
  const finding: ReviewFinding = {
    id: primary.id,
    title: primary.title,
    body: primary.body,
    file: primary.file,
    severity: primary.severity,
    confidence: primary.confidence,
    category: primary.category,
    evidence
  };

  if (primary.startLine) {
    finding.startLine = primary.startLine;
  }

  if (primary.endLine) {
    finding.endLine = primary.endLine;
  }

  if (patchCandidate?.suggestedPatch) {
    finding.suggestedPatch = patchCandidate.suggestedPatch;
  }

  if (testsCandidate?.suggestedTests) {
    finding.suggestedTests = testsCandidate.suggestedTests;
  }

  return finding;
}

function specialtyWeight(reviewer: ReviewerKind, category: string): number {
  if (reviewer === "security" && category === "security") {
    return 4;
  }

  if (reviewer === "test" && (category === "testing" || category === "test")) {
    return 4;
  }

  if (
    reviewer === "quality" &&
    ["correctness", "quality", "maintainability"].includes(category)
  ) {
    return 4;
  }

  return 0;
}

function vagueFindingPenalty(candidate: ReviewFindingCandidate): number {
  let penalty = 0;

  if (candidate.title.length < 12) {
    penalty += 5;
  }

  if (candidate.body.length < 40) {
    penalty += 5;
  }

  if (candidate.evidence.length === 0) {
    penalty += 4;
  }

  if (!candidate.startLine) {
    penalty += 2;
  }

  return penalty;
}

function normalizeLineRange(candidate: ReviewFindingCandidate): string {
  if (!candidate.startLine) {
    return "file";
  }

  const bucketStart = Math.floor((candidate.startLine - 1) / 5) * 5 + 1;
  const bucketEnd = bucketStart + 4;

  return `${bucketStart}-${bucketEnd}`;
}

function createDecision(
  candidate: ReviewFindingCandidate,
  decision: RefereeCandidateDecision,
  score: number,
  reason: string,
  mergedIntoId?: string
): RefereeDecision["decisions"][number] {
  const item: RefereeDecision["decisions"][number] = {
    candidateId: candidate.id,
    decision,
    score,
    reason
  };

  if (mergedIntoId) {
    item.mergedIntoId = mergedIntoId;
  }

  return item;
}

function dedupeStrings(values: string[]): string[] {
  return [...new Set(values)];
}
