import fs from "node:fs/promises";
import path from "node:path";
import { PullRequestWebhookSchema } from "@repocouncil/shared";
import { parsePatchHunks } from "../github/diff-parser.js";

const fixturePath =
  process.argv[2] ?? path.resolve("fixtures/pull-request.opened.json");

const payload = JSON.parse(await fs.readFile(fixturePath, "utf8")) as unknown;
const event = PullRequestWebhookSchema.parse(payload);

const samplePatch = [
  "@@ -1,4 +1,10 @@",
  " export function scoreFinding(confidence: number) {",
  "-  return confidence > 0.5 ? 'high' : 'low';",
  "+  if (confidence > 0.8) {",
  "+    return 'high';",
  "+  }",
  "+",
  "+  return 'low';",
  " }"
].join("\n");

const hunks = parsePatchHunks(samplePatch);

if (hunks.length !== 1) {
  throw new Error(`Expected one parsed hunk, received ${hunks.length}.`);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      repository: event.repository.full_name,
      pullNumber: event.pull_request.number,
      action: event.action,
      parsedHunks: hunks.length
    },
    null,
    2
  )
);
