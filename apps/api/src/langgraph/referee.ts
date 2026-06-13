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

type NormalizedIssueType =
  | "ownership_access_control"
  | "request_controlled_identity"
  | "input_validation"
  | "missing_negative_test"
  | "data_exposure"
  | "audit_consistency"
  | "authorization"
  | "webhook_signature"
  | "generic";

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
    categoryMismatchPenalty(candidate) -
    vagueFindingPenalty(candidate)
  );
}

export function runDeterministicReferee(
  candidates: ReviewFindingCandidate[]
): RefereeResult {
  const preRejectedCandidates = candidates.flatMap((candidate) => {
    const reason = getPreGroupingRejectionReason(candidate);

    return reason ? [{ candidate, reason }] : [];
  });
  const preRejectedCandidateSet = new Set(preRejectedCandidates.map((item) => item.candidate));
  const eligibleCandidates = candidates.filter((candidate) => !preRejectedCandidateSet.has(candidate));
  const companionTargets = findTestingCompanionTargets(eligibleCandidates);
  const nonCompanionCandidates = eligibleCandidates.filter((candidate) => !companionTargets.has(candidate));
  const groups = groupCandidates(nonCompanionCandidates);
  const companionsByGroupKey = groupTestingCompanions(groups, companionTargets);
  const findings: ReviewFinding[] = [];
  const decisions: RefereeDecision["decisions"] = preRejectedCandidates.map(({ candidate, reason }) =>
    createDecision(
      candidate,
      "rejected",
      scoreFindingCandidate(candidate),
      reason
    )
  );

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

    for (const candidate of ranked.filter((candidate) => candidate !== primary)) {
      const isTestingCompanion = companionTargets.get(candidate) !== undefined;
      decisions.push(
        createDecision(
          candidate,
          "merged",
          scoreFindingCandidate(candidate) - DUPLICATE_PENALTY,
          isTestingCompanion
            ? "Merged into primary finding as suggestedTests."
            : "Merged into higher-scoring duplicate candidate.",
          decisionCandidateId(primary)
        )
      );
    }
  }

  const decidedCandidateIds = new Set(decisions.map((decision) => decision.candidateId));

  for (const candidate of candidates) {
    const candidateId = decisionCandidateId(candidate);

    if (!decidedCandidateIds.has(candidateId)) {
      decisions.push(
        createDecision(
          candidate,
          "rejected",
          scoreFindingCandidate(candidate),
          "Candidate was not selected by referee."
        )
      );
      decidedCandidateIds.add(candidateId);
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
  if (!candidate.file) {
    return "Evidence gate rejected candidate without changed-file path.";
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
    const key = findSemanticDuplicateGroupKey(candidate, groups) ?? groupKeyForCandidate(candidate);
    const group = groups.get(key) ?? [];
    group.push(candidate);
    groups.set(key, group);
  }

  return groups;
}

function findTestingCompanionTargets(
  candidates: ReviewFindingCandidate[]
): Map<ReviewFindingCandidate, ReviewFindingCandidate> {
  const targets = new Map<ReviewFindingCandidate, ReviewFindingCandidate>();
  const primaryCandidates = candidates.filter(isPrimaryRiskFinding);
  const testingCandidates = candidates.filter(isTestingFinding);

  for (const testingCandidate of testingCandidates) {
    const target = primaryCandidates
      .filter((primaryCandidate) => isTestingCompanion(testingCandidate, primaryCandidate))
      .sort((left, right) => scoreFindingCandidate(right) - scoreFindingCandidate(left))[0];

    if (target) {
      targets.set(testingCandidate, target);
    }
  }

  return targets;
}

function groupTestingCompanions(
  groups: Map<string, ReviewFindingCandidate[]>,
  companionTargets: Map<ReviewFindingCandidate, ReviewFindingCandidate>
): Map<string, ReviewFindingCandidate[]> {
  const companionsByGroupKey = new Map<string, ReviewFindingCandidate[]>();

  for (const [companion, target] of companionTargets.entries()) {
    const groupKey = findGroupKeyContainingCandidate(groups, target);

    if (!groupKey) {
      continue;
    }

    const companions = companionsByGroupKey.get(groupKey) ?? [];
    companions.push(companion);
    companionsByGroupKey.set(groupKey, companions);
  }

  return companionsByGroupKey;
}

function findGroupKeyContainingCandidate(
  groups: Map<string, ReviewFindingCandidate[]>,
  target: ReviewFindingCandidate
): string | null {
  for (const [groupKey, group] of groups.entries()) {
    if (group.includes(target)) {
      return groupKey;
    }
  }

  return null;
}

function isTestingCompanion(
  testingCandidate: ReviewFindingCandidate,
  primaryCandidate: ReviewFindingCandidate
): boolean {
  if (!areIssueTypesCompatible(normalizedIssueType(testingCandidate), normalizedIssueType(primaryCandidate))) {
    return false;
  }

  if (
    normalizedIssueType(testingCandidate) === "missing_negative_test" &&
    hasSharedBehaviorTerms(testingCandidate, primaryCandidate)
  ) {
    return true;
  }

  return (
    testingCandidate.file === primaryCandidate.file &&
    areNearby(testingCandidate, primaryCandidate) &&
    hasSharedBehaviorTerms(testingCandidate, primaryCandidate)
  );
}

function isPrimaryRiskFinding(candidate: ReviewFindingCandidate): boolean {
  return ["security", "correctness", "quality", "maintainability"].includes(candidate.category);
}

function isTestingFinding(candidate: ReviewFindingCandidate): boolean {
  return candidate.reviewer === "test" || candidate.category === "testing" || candidate.category === "test";
}

function getPreGroupingRejectionReason(candidate: ReviewFindingCandidate): string | null {
  if (isWebhookSignatureFalsePositive(candidate)) {
    return "Rejected webhook signature false positive on a non-webhook API route.";
  }

  if (isVagueMaintainabilityCandidate(candidate)) {
    return "Rejected vague maintainability candidate without strong concrete evidence.";
  }

  if (isVagueModelTestCandidate(candidate)) {
    return "Rejected vague model-level test coverage candidate without a concrete behavior gap.";
  }

  return null;
}

function isVagueMaintainabilityCandidate(candidate: ReviewFindingCandidate): boolean {
  const text = allCandidateText(candidate);

  return (
    candidate.category === "maintainability" &&
    candidate.reviewer === "quality" &&
    text.includes("potential") &&
    !text.includes("regression") &&
    !text.includes("break") &&
    !text.includes("fails")
  );
}

function isVagueModelTestCandidate(candidate: ReviewFindingCandidate): boolean {
  const text = allCandidateText(candidate);

  return (
    isTestingFinding(candidate) &&
    text.includes("no test coverage") &&
    text.includes("model") &&
    !text.includes("authorization") &&
    !text.includes("permission") &&
    !text.includes("route")
  );
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
  const suggestedTests = mergeSuggestedTests(primary, group);
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

function mergeSuggestedTests(
  primary: ReviewFindingCandidate,
  group: ReviewFindingCandidate[]
): string | undefined {
  const primaryIssueType = normalizedIssueType(primary);
  const suggestions = dedupeTestSuggestions(
    group.flatMap((candidate) => {
      if (!areIssueTypesCompatible(primaryIssueType, normalizedIssueType(candidate))) {
        return [];
      }

      if (candidate.suggestedTests) {
        return splitSuggestedTests(candidate.suggestedTests);
      }

      return isTestingFinding(candidate) ? [candidate.body] : [];
    })
  ).slice(0, 3);

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

function categoryMismatchPenalty(candidate: ReviewFindingCandidate): number {
  if (candidate.category !== "security") {
    return 0;
  }

  if (hasSecurityRiskTerms(candidate)) {
    return 0;
  }

  return 12;
}

function hasSecurityRiskTerms(candidate: ReviewFindingCandidate): boolean {
  const text = allCandidateText(candidate);

  return [
    "auth",
    "authorization",
    "authentication",
    "role",
    "permission",
    "tenant",
    "owner",
    "ownership",
    "signature",
    "webhook",
    "token",
    "secret",
    "injection",
    "xss",
    "csrf",
    "ssrf"
  ].some((term) => text.includes(term));
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
  return `${normalizedIssueType(candidate)}:${candidate.file}:${normalizeLineRange(candidate)}:${candidate.category}`;
}

function findSemanticDuplicateGroupKey(
  candidate: ReviewFindingCandidate,
  groups: Map<string, ReviewFindingCandidate[]>
): string | null {
  for (const [groupKey, group] of groups.entries()) {
    if (group.some((existingCandidate) => areSemanticDuplicates(candidate, existingCandidate))) {
      return groupKey;
    }
  }

  return null;
}

function areSemanticDuplicates(
  left: ReviewFindingCandidate,
  right: ReviewFindingCandidate
): boolean {
  const leftIssueType = normalizedIssueType(left);
  const rightIssueType = normalizedIssueType(right);

  if (!areIssueTypesCompatible(leftIssueType, rightIssueType)) {
    return false;
  }

  const sharedFamilies = intersectSets(semanticFamilies(left), semanticFamilies(right));

  if (!canMergeAcrossLocations(left, right, sharedFamilies)) {
    return false;
  }

  const leftTerms = extractBehaviorTerms(allCandidateText(left));
  const rightTerms = extractBehaviorTerms(allCandidateText(right));
  const sharedTerms = countSharedTerms(leftTerms, rightTerms);

  if (sharedFamilies.size === 0 || sharedTerms < 2) {
    return false;
  }

  return true;
}

function canMergeAcrossLocations(
  left: ReviewFindingCandidate,
  right: ReviewFindingCandidate,
  sharedFamilies: Set<string>
): boolean {
  const leftIssueType = normalizedIssueType(left);
  const rightIssueType = normalizedIssueType(right);

  return (
    left.file === right.file ||
    left.category === right.category ||
    (leftIssueType === "input_validation" && rightIssueType === "input_validation" && sharedFamilies.has("validation"))
  );
}

function countSharedTerms(left: Set<string>, right: Set<string>): number {
  return [...left].filter((term) => right.has(term)).length;
}

function sharesAnyTerm(left: Set<string>, right: Set<string>, terms: Set<string>): boolean {
  return [...terms].some((term) => left.has(term) && right.has(term));
}

function intersectSets<T>(left: Set<T>, right: Set<T>): Set<T> {
  return new Set([...left].filter((item) => right.has(item)));
}

function semanticFamilies(candidate: ReviewFindingCandidate): Set<string> {
  const terms = extractBehaviorTerms(coreCandidateText(candidate));
  const families = new Set<string>();

  if (sharesAnyTerm(terms, terms, VALIDATION_TERMS)) {
    families.add("validation");
  }

  if (hasAuthorizationFamily(terms)) {
    families.add("authorization");
  }

  if (sharesAnyTerm(terms, terms, AUDIT_TERMS)) {
    families.add("audit_consistency");
  }

  return families;
}

function normalizedIssueType(candidate: ReviewFindingCandidate): NormalizedIssueType {
  const text = allCandidateText(candidate);

  if (isMissingNegativeTest(candidate, text)) {
    return "missing_negative_test";
  }

  if (text.includes("webhook") && text.includes("signature")) {
    return "webhook_signature";
  }

  if (hasRequestControlledIdentityIssue(text)) {
    return "request_controlled_identity";
  }

  if (hasInputValidationIssue(text)) {
    return "input_validation";
  }

  if (hasOwnershipAccessControlIssue(text)) {
    return "ownership_access_control";
  }

  if (hasDataExposureIssue(text)) {
    return "data_exposure";
  }

  if (hasAuditConsistencyIssue(text)) {
    return "audit_consistency";
  }

  if (hasAuthorizationIssue(text)) {
    return "authorization";
  }

  return "generic";
}

function areIssueTypesCompatible(
  left: NormalizedIssueType,
  right: NormalizedIssueType
): boolean {
  if (left === right) {
    return true;
  }

  const pair = new Set([left, right]);

  return (
    (pair.has("missing_negative_test") &&
      (pair.has("ownership_access_control") ||
        pair.has("request_controlled_identity") ||
        pair.has("input_validation") ||
        pair.has("authorization"))) ||
    (pair.has("ownership_access_control") && pair.has("request_controlled_identity"))
  );
}

function isMissingNegativeTest(candidate: ReviewFindingCandidate, text: string): boolean {
  return (
    isTestingFinding(candidate) &&
    (text.includes("negative") ||
      text.includes("cross-user") ||
      text.includes("user a") ||
      text.includes("403") ||
      text.includes("401") ||
      text.includes("unauthorized") ||
      text.includes("forbidden"))
  );
}

function hasRequestControlledIdentityIssue(text: string): boolean {
  return (
    /req\.(?:params|body|query)\.(?:userid|user_id|authorid|author_id|ownerid|owner_id)/i.test(text) ||
    text.includes("request-controlled userid") ||
    text.includes("request controlled userid") ||
    text.includes("params userid") ||
    text.includes("body userid") ||
    text.includes("query userid")
  );
}

function hasOwnershipAccessControlIssue(text: string): boolean {
  return (
    (text.includes("draft") ||
      text.includes("private") ||
      text.includes("visibility") ||
      text.includes("owner") ||
      text.includes("author")) &&
    (text.includes("ownership") ||
      text.includes("access") ||
      text.includes("authorize") ||
      text.includes("authorization") ||
      text.includes("permission") ||
      text.includes("403"))
  );
}

function hasInputValidationIssue(text: string): boolean {
  return (
    (text.includes("validation") ||
      text.includes("validate") ||
      text.includes("invalid") ||
      text.includes("required") ||
      text.includes("input") ||
      text.includes("field") ||
      text.includes("title") ||
      text.includes("content") ||
      text.includes("category") ||
      text.includes("visibility")) &&
    !hasRequestControlledIdentityIssue(text) &&
    !text.includes("ownership check")
  );
}

function hasDataExposureIssue(text: string): boolean {
  return text.includes("exposure") || text.includes("leak") || text.includes("sensitive") || text.includes("private data");
}

function hasAuditConsistencyIssue(text: string): boolean {
  return (
    text.includes("audit") &&
    (text.includes("transaction") ||
      text.includes("atomic") ||
      text.includes("consistency") ||
      text.includes("rollback") ||
      text.includes("partial"))
  );
}

function hasAuthorizationIssue(text: string): boolean {
  return (
    text.includes("authorization") ||
    text.includes("permission") ||
    text.includes("role") ||
    text.includes("unauthorized") ||
    text.includes("forbidden")
  );
}

function splitSuggestedTests(value: string): string[] {
  return value
    .split(/\n\s*\n|\n(?=\s*(?:[-*]|\d+[.)])\s+)/)
    .map((item) => item.replace(/^\s*(?:[-*]|\d+[.)])\s+/, "").trim())
    .filter(Boolean);
}

function dedupeTestSuggestions(values: string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];

  for (const value of values) {
    const key = normalizeTestSuggestion(value);

    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(value);
    }
  }

  return deduped;
}

function normalizeTestSuggestion(value: string): string {
  const lower = value.toLowerCase();

  if (
    (lower.includes("private") || lower.includes("owned") || lower.includes("resource")) &&
    lower.includes("cannot access") &&
    (lower.includes("user a") ||
      lower.includes("another user") ||
      lower.includes("other user") ||
      lower.includes("non-owner") ||
      lower.includes("non owner"))
  ) {
    return "cross-user-resource-denied";
  }

  if (lower.includes("unauthenticated") || lower.includes("without authentication")) {
    return "unauthenticated-denied";
  }

  if (
    lower.includes("owner") &&
    lower.includes("access") &&
    (lower.includes("own draft") || lower.includes("own private resource") || lower.includes("own resource"))
  ) {
    return "owner-access-own-resource";
  }

  return lower
    .toLowerCase()
    .replace(/\b(user a|another user|non-owner|non owner|other user)\b/g, "cross-user")
    .replace(/\b(user b|owner)\b/g, "owner")
    .replace(/\b(unauthorized|forbidden|403)\b/g, "denied")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function hasAuthorizationFamily(terms: Set<string>): boolean {
  return (
    sharesAnyTerm(terms, terms, AUTHORIZATION_TERMS) ||
    (terms.has("admin") && (terms.has("access") || terms.has("check") || terms.has("negative")))
  );
}

const VALIDATION_TERMS = new Set([
  "valid",
  "validate",
  "validating",
  "validation",
  "validated",
  "unvalidated",
  "invalid",
  "required",
  "empty",
  "bounded",
  "sanitize",
  "sanitized"
]);

const AUTHORIZATION_TERMS = new Set([
  "auth",
  "authentication",
  "authorization",
  "authorize",
  "authorized",
  "unauthorized",
  "forbidden",
  "role",
  "permission",
  "privilege",
  "tenant",
  "ownership",
  "owner"
]);

const AUDIT_TERMS = new Set([
  "audit",
  "auditing",
  "transaction",
  "consistency",
  "partial",
  "failure",
  "rollback"
]);

function isWebhookSignatureFalsePositive(candidate: ReviewFindingCandidate): boolean {
  const text = allCandidateText(candidate);
  const mentionsWebhookSignature =
    text.includes("webhook") && text.includes("signature") && text.includes("verification");
  const fileLooksWebhook = candidate.file.toLowerCase().includes("webhook");

  return mentionsWebhookSignature && !fileLooksWebhook;
}

function createDecision(
  candidate: ReviewFindingCandidate,
  decision: RefereeCandidateDecision,
  score: number,
  reason: string,
  mergedIntoId?: string
): RefereeDecision["decisions"][number] {
  const item: RefereeDecision["decisions"][number] = {
    candidateId: decisionCandidateId(candidate),
    decision,
    score,
    reason
  };

  if (mergedIntoId) {
    item.mergedIntoId = mergedIntoId;
  }

  return item;
}

function decisionCandidateId(candidate: ReviewFindingCandidate): string {
  return candidate.reviewerRunId ?? candidate.id;
}

function allCandidateText(candidate: ReviewFindingCandidate): string {
  return `${candidate.title} ${candidate.body} ${candidate.file} ${candidate.category} ${candidate.evidence.join(" ")}`.toLowerCase();
}

function coreCandidateText(candidate: ReviewFindingCandidate): string {
  return `${candidate.title} ${candidate.body} ${candidate.file} ${candidate.category}`.toLowerCase();
}

function dedupeStrings(values: string[]): string[] {
  return [...new Set(values)];
}
