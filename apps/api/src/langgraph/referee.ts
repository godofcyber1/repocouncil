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
  const companionTargets = findTestingCompanionTargets(candidates);
  const nonCompanionCandidates = candidates.filter((candidate) => !companionTargets.has(candidate.id));
  const groups = groupCandidates(nonCompanionCandidates);
  const companionsByGroupKey = groupTestingCompanions(candidates, companionTargets);
  const findings: ReviewFinding[] = [];
  const decisions: RefereeDecision["decisions"] = [];

  for (const [groupKey, baseGroup] of groups.entries()) {
    const group = [...baseGroup, ...(companionsByGroupKey.get(groupKey) ?? [])];
    const ranked = [...group].sort((left, right) => scoreFindingCandidate(right) - scoreFindingCandidate(left));
    const rankedPrimaryCandidates = [...baseGroup].sort(
      (left, right) => scoreFindingCandidate(right) - scoreFindingCandidate(left)
    );
    const primary = rankedPrimaryCandidates[0];

    if (!primary) {
      continue;
    }

    const evidenceGateFailure = getEvidenceGateFailure(primary);

    if (evidenceGateFailure) {
      for (const candidate of ranked) {
        decisions.push(
          createDecision(candidate, "rejected", scoreFindingCandidate(candidate), evidenceGateFailure)
        );
      }
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

    for (const candidate of ranked.filter((candidate) => candidate.id !== primary.id)) {
      const isTestingCompanion = companionTargets.get(candidate.id) !== undefined;
      decisions.push(
        createDecision(
          candidate,
          "merged",
          scoreFindingCandidate(candidate) - DUPLICATE_PENALTY,
          isTestingCompanion
            ? "Merged into primary finding as suggestedTests."
            : "Merged into higher-scoring duplicate candidate.",
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
      duplicateGroups: [...groups.entries()].filter(
        ([groupKey, group]) => group.length + (companionsByGroupKey.get(groupKey)?.length ?? 0) > 1
      ).length,
      decisions
    }
  };
}

function getEvidenceGateFailure(candidate: ReviewFindingCandidate): string | null {
  if (!candidate.file || !candidate.startLine) {
    return "Evidence gate rejected candidate without changed-file line location.";
  }

  if (!candidate.category) {
    return "Evidence gate rejected candidate without a risk category.";
  }

  if (candidate.evidence.length === 0) {
    return "Evidence gate rejected candidate without an evidence chain.";
  }

  if (candidate.category === "suspicion" || candidate.confidence < 0.45) {
    return "Evidence gate kept unverified suspicion in trace only.";
  }

  return null;
}

function groupCandidates(
  candidates: ReviewFindingCandidate[]
): Map<string, ReviewFindingCandidate[]> {
  const groups = new Map<string, ReviewFindingCandidate[]>();

  for (const candidate of candidates) {
    const key = groupKeyForCandidate(candidate);
    const group = groups.get(key) ?? [];
    group.push(candidate);
    groups.set(key, group);
  }

  return groups;
}

function findTestingCompanionTargets(
  candidates: ReviewFindingCandidate[]
): Map<string, ReviewFindingCandidate> {
  const targets = new Map<string, ReviewFindingCandidate>();
  const primaryCandidates = candidates.filter(isPrimaryRiskFinding);
  const testingCandidates = candidates.filter(isTestingFinding);

  for (const testingCandidate of testingCandidates) {
    const target = primaryCandidates
      .filter((primaryCandidate) => isTestingCompanion(testingCandidate, primaryCandidate))
      .sort((left, right) => scoreFindingCandidate(right) - scoreFindingCandidate(left))[0];

    if (target) {
      targets.set(testingCandidate.id, target);
    }
  }

  return targets;
}

function groupTestingCompanions(
  candidates: ReviewFindingCandidate[],
  companionTargets: Map<string, ReviewFindingCandidate>
): Map<string, ReviewFindingCandidate[]> {
  const companionsByGroupKey = new Map<string, ReviewFindingCandidate[]>();
  const candidatesById = new Map(candidates.map((candidate) => [candidate.id, candidate]));

  for (const [companionId, target] of companionTargets.entries()) {
    const companion = candidatesById.get(companionId);

    if (!companion) {
      continue;
    }

    const groupKey = groupKeyForCandidate(target);
    const companions = companionsByGroupKey.get(groupKey) ?? [];
    companions.push(companion);
    companionsByGroupKey.set(groupKey, companions);
  }

  return companionsByGroupKey;
}

function isTestingCompanion(
  testingCandidate: ReviewFindingCandidate,
  primaryCandidate: ReviewFindingCandidate
): boolean {
  return (
    testingCandidate.file === primaryCandidate.file &&
    areNearby(testingCandidate, primaryCandidate) &&
    hasSharedBehaviorTerms(testingCandidate, primaryCandidate)
  );
}

function isPrimaryRiskFinding(candidate: ReviewFindingCandidate): boolean {
  return ["security", "correctness"].includes(candidate.category);
}

function isTestingFinding(candidate: ReviewFindingCandidate): boolean {
  return candidate.reviewer === "test" || candidate.category === "testing" || candidate.category === "test";
}

function areNearby(left: ReviewFindingCandidate, right: ReviewFindingCandidate): boolean {
  if (!left.startLine || !right.startLine) {
    return false;
  }

  const leftEnd = left.endLine ?? left.startLine;
  const rightEnd = right.endLine ?? right.startLine;

  return left.startLine <= rightEnd + 5 && leftEnd >= right.startLine - 5;
}

function hasSharedBehaviorTerms(
  testingCandidate: ReviewFindingCandidate,
  primaryCandidate: ReviewFindingCandidate
): boolean {
  const testingTerms = extractBehaviorTerms(
    `${testingCandidate.title} ${testingCandidate.body} ${testingCandidate.evidence.join(" ")}`
  );
  const primaryTerms = extractBehaviorTerms(
    `${primaryCandidate.title} ${primaryCandidate.body} ${primaryCandidate.evidence.join(" ")}`
  );

  return [...testingTerms].filter((term) => primaryTerms.has(term)).length >= 2;
}

function extractBehaviorTerms(value: string): Set<string> {
  const ignored = new Set([
    "test",
    "tests",
    "testing",
    "missing",
    "should",
    "would",
    "could",
    "with",
    "when",
    "from",
    "that",
    "this",
    "into",
    "same",
    "behavior",
    "finding",
    "review"
  ]);

  return new Set(
    value
      .toLowerCase()
      .split(/[^a-z0-9_]+/)
      .filter((term) => term.length >= 4 && !ignored.has(term))
  );
}

function mergeGroup(
  primary: ReviewFindingCandidate,
  group: ReviewFindingCandidate[]
): ReviewFinding {
  const evidence = dedupeStrings(group.flatMap((candidate) => candidate.evidence));
  const patchCandidate = group.find((candidate) => candidate.suggestedPatch);
  const suggestedTests = mergeSuggestedTests(group);
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

  if (suggestedTests) {
    finding.suggestedTests = suggestedTests;
  }

  return finding;
}

function mergeSuggestedTests(group: ReviewFindingCandidate[]): string | undefined {
  const suggestions = dedupeStrings(
    group.flatMap((candidate) => {
      if (candidate.suggestedTests) {
        return [candidate.suggestedTests];
      }

      return isTestingFinding(candidate) ? [candidate.body] : [];
    })
  );

  return suggestions.length > 0 ? suggestions.join("\n\n") : undefined;
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

function groupKeyForCandidate(candidate: ReviewFindingCandidate): string {
  return `${candidate.file}:${normalizeLineRange(candidate)}:${candidate.category}`;
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
