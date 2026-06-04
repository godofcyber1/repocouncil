export type ParsedDiffHunk = {
  header: string;
  oldStart?: number;
  oldLines?: number;
  newStart?: number;
  newLines?: number;
  body: string;
};

const HUNK_HEADER_PATTERN = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

export function parsePatchHunks(patch: string | null | undefined): ParsedDiffHunk[] {
  if (!patch) {
    return [];
  }

  const hunks: ParsedDiffHunk[] = [];
  let current: ParsedDiffHunk | undefined;

  for (const line of patch.split("\n")) {
    const match = HUNK_HEADER_PATTERN.exec(line);

    if (match) {
      if (current) {
        hunks.push(current);
      }

      current = {
        header: line,
        oldStart: Number(match[1]),
        oldLines: Number(match[2] ?? 1),
        newStart: Number(match[3]),
        newLines: Number(match[4] ?? 1),
        body: ""
      };
      continue;
    }

    if (current) {
      current.body = current.body ? `${current.body}\n${line}` : line;
    }
  }

  if (current) {
    hunks.push(current);
  }

  return hunks;
}
