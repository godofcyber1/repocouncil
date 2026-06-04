import { describe, expect, it } from "vitest";
import {
  calculateReviewQualityIndex,
  evaluateReview,
  matchFindingsToGroundTruth,
  type GroundTruthIssue,
  type PredictedFinding
} from "./index.js";

const baseIssue: GroundTruthIssue = {
  issue_id: "gt_1",
  file_path: "src/auth.ts",
  line_start: 10,
  line_end: 12,
  category: "bug",
  severity: "high",
  description: "Incorrect auth branch."
};

const basePrediction: PredictedFinding = {
  finding_id: "pred_1",
  file_path: "src/auth.ts",
  line_start: 10,
  line_end: 12,
  category: "bug",
  severity: "high",
  confidence: 0.9,
  evidence: "src/auth.ts lines 10-12",
  explanation: "The branch can return the wrong auth result.",
  suggested_fix: "Check the auth condition before returning.",
  verification_status: "passed",
  cost_usd: 0.01,
  latency_seconds: 5
};

describe("RepoCouncil evaluation", () => {
  it("scores a perfect prediction as 1.0 precision, recall, and weighted F0.5", () => {
    const groundTruth: GroundTruthIssue[] = [
      baseIssue,
      {
        ...baseIssue,
        issue_id: "gt_2",
        file_path: "src/session.ts",
        line_start: 20,
        line_end: 20,
        severity: "medium"
      }
    ];
    const predictions: PredictedFinding[] = [
      basePrediction,
      {
        ...basePrediction,
        finding_id: "pred_2",
        file_path: "src/session.ts",
        line_start: 20,
        line_end: 20,
        severity: "medium"
      }
    ];

    const result = evaluateReview(groundTruth, predictions);

    expect(result.true_positives).toBe(2);
    expect(result.false_positives).toBe(0);
    expect(result.false_negatives).toBe(0);
    expect(result.weighted_precision).toBe(1);
    expect(result.weighted_recall).toBe(1);
    expect(result.weighted_f0_5).toBe(1);
  });

  it("counts one unmatched prediction as a false positive", () => {
    const result = evaluateReview(
      [baseIssue],
      [
        basePrediction,
        {
          ...basePrediction,
          finding_id: "pred_fp",
          file_path: "src/other.ts"
        }
      ]
    );

    expect(result.true_positives).toBe(1);
    expect(result.false_positives).toBe(1);
    expect(result.false_negatives).toBe(0);
    expect(result.weighted_precision).toBeLessThan(1);
    expect(result.weighted_recall).toBe(1);
  });

  it("counts one missed ground truth issue as a false negative", () => {
    const result = evaluateReview(
      [
        baseIssue,
        {
          ...baseIssue,
          issue_id: "gt_missed",
          file_path: "src/missed.ts"
        }
      ],
      [basePrediction]
    );

    expect(result.true_positives).toBe(1);
    expect(result.false_positives).toBe(0);
    expect(result.false_negatives).toBe(1);
    expect(result.weighted_precision).toBe(1);
    expect(result.weighted_recall).toBeLessThan(1);
  });

  it("penalizes missing a critical issue more than missing a low issue", () => {
    const matchedLow: GroundTruthIssue = {
      ...baseIssue,
      issue_id: "gt_low",
      severity: "low"
    };
    const missedCritical: GroundTruthIssue = {
      ...baseIssue,
      issue_id: "gt_critical",
      file_path: "src/critical.ts",
      severity: "critical"
    };
    const missedLow: GroundTruthIssue = {
      ...baseIssue,
      issue_id: "gt_low_missed",
      file_path: "src/low.ts",
      severity: "low"
    };

    const criticalMiss = evaluateReview([matchedLow, missedCritical], [basePrediction]);
    const lowMiss = evaluateReview([matchedLow, missedLow], [basePrediction]);

    expect(criticalMiss.weighted_recall).toBeLessThan(lowMiss.weighted_recall);
  });

  it("matches only one duplicate prediction and marks the other as false positive", () => {
    const matchResult = matchFindingsToGroundTruth(
      [baseIssue],
      [
        basePrediction,
        {
          ...basePrediction,
          finding_id: "pred_duplicate",
          confidence: 0.8
        }
      ]
    );

    expect(matchResult.matches).toHaveLength(1);
    expect(matchResult.false_positives).toHaveLength(1);
    expect(matchResult.false_negatives).toHaveLength(0);
  });

  it("returns 100 for dashboard review quality index when all components are 1", () => {
    expect(calculateReviewQualityIndex(1, 1, 1, 1, 1, 1)).toBe(100);
  });

  it("handles zero predictions without division by zero", () => {
    const result = evaluateReview([baseIssue], []);

    expect(result.true_positives).toBe(0);
    expect(result.false_positives).toBe(0);
    expect(result.false_negatives).toBe(1);
    expect(result.grounding_rate).toBe(0);
    expect(result.actionable_rate).toBe(0);
    expect(result.localization_accuracy).toBe(0);
    expect(result.verified_fix_rate).toBe(0);
    expect(result.efficiency_score).toBe(1);
  });
});
