import fs from "node:fs/promises";
import path from "node:path";

type CheckStatus = "pass" | "warn" | "fail";

type ReadinessCheck = {
  id: string;
  title: string;
  status: CheckStatus;
  detail: string;
};

const repoRoot = path.resolve("../..");
const reportDir = path.join(repoRoot, "docs/private/milestone-test-reports");
const reportPath = path.join(reportDir, "p7-deployment-readiness.md");

await fs.mkdir(reportDir, { recursive: true });

const packageJson = await readJson<Record<string, unknown>>(path.join(repoRoot, "package.json"));
const apiPackageJson = await readJson<Record<string, unknown>>(path.join(repoRoot, "apps/api/package.json"));
const webPackageJson = await readJson<Record<string, unknown>>(path.join(repoRoot, "apps/web/package.json"));
const envExample = await readText(path.join(repoRoot, ".env.example"));
const dockerComposeExists = await exists(path.join(repoRoot, "docker-compose.yml"));
const apiDockerfileExists = await exists(path.join(repoRoot, "apps/api/Dockerfile"));
const webDockerfileExists = await exists(path.join(repoRoot, "apps/web/Dockerfile"));
const dockerignoreExists = await exists(path.join(repoRoot, ".dockerignore"));
const publicDocs = await listPublicDocs();

const checks: ReadinessCheck[] = [
  checkScript(packageJson, "build", "Root build script exists."),
  checkScript(packageJson, "typecheck", "Root typecheck script exists."),
  checkScript(packageJson, "test", "Root test script exists."),
  checkScript(packageJson, "eval:fixed", "Fixed evaluation script exists."),
  checkScript(packageJson, "publish:mock", "Mock publish validation script exists."),
  checkScript(packageJson, "dashboard:mock", "Dashboard data-contract validation script exists."),
  checkScript(apiPackageJson, "start", "API production start script exists."),
  checkScript(webPackageJson, "start", "Web production start script exists."),
  checkEnv(envExample, "DATABASE_URL", "Database URL is documented in .env.example."),
  checkEnv(envExample, "GITHUB_APP_ID", "GitHub App ID is documented in .env.example."),
  checkEnv(envExample, "GITHUB_APP_PRIVATE_KEY", "GitHub App private key is documented in .env.example."),
  checkEnv(envExample, "GITHUB_WEBHOOK_SECRET", "GitHub webhook secret is documented in .env.example."),
  checkEnv(envExample, "MODEL_PROVIDER", "Model provider selection is documented in .env.example."),
  checkEnv(envExample, "QWEN_API_KEY", "Qwen API key is documented in .env.example."),
  checkEnv(envExample, "API_BASE_URL", "API base URL is documented in .env.example."),
  checkEnv(envExample, "WEB_BASE_URL", "Web base URL is documented in .env.example."),
  checkEnv(envExample, "DASHBOARD_BASE_URL", "Dashboard base URL for GitHub output is documented in .env.example."),
  checkFile(
    dockerComposeExists,
    "docker-compose-postgres",
    "Postgres docker-compose exists.",
    "docker-compose.yml exists for local Postgres.",
    "docker-compose.yml is missing."
  ),
  checkFile(
    apiDockerfileExists,
    "api-dockerfile",
    "API Dockerfile exists.",
    "apps/api/Dockerfile exists.",
    "apps/api/Dockerfile is missing; API is not yet Dockerized."
  ),
  checkFile(
    webDockerfileExists,
    "web-dockerfile",
    "Web Dockerfile exists.",
    "apps/web/Dockerfile exists.",
    "apps/web/Dockerfile is missing; dashboard is not yet Dockerized."
  ),
  checkFile(
    dockerignoreExists,
    "dockerignore",
    ".dockerignore exists.",
    ".dockerignore exists.",
    ".dockerignore is missing; deployment builds may copy unnecessary or sensitive local files."
  ),
  checkPublicDoc(publicDocs, "architecture.md", "Public architecture doc exists."),
  checkPublicDoc(publicDocs, "qwen-configuration.md", "Qwen configuration doc exists."),
  checkPublicDoc(publicDocs, "tool-evidence.md", "Tool evidence setup doc exists.")
];

await fs.writeFile(reportPath, renderReport(checks), "utf8");

const summary = summarize(checks);

console.log(
  JSON.stringify(
    {
      reportPath,
      summary,
      checks
    },
    null,
    2
  )
);

if (summary.fail > 0) {
  process.exitCode = 1;
}

function checkScript(packageData: Record<string, unknown>, scriptName: string, title: string): ReadinessCheck {
  const scripts = isRecord(packageData.scripts) ? packageData.scripts : {};
  const script = scripts[scriptName];

  return {
    id: `script-${scriptName}`,
    title,
    status: typeof script === "string" && script.length > 0 ? "pass" : "fail",
    detail:
      typeof script === "string" && script.length > 0
        ? `Found script "${scriptName}".`
        : `Missing script "${scriptName}".`
  };
}

function checkEnv(envExampleText: string, key: string, title: string): ReadinessCheck {
  const hasKey = new RegExp(`^${escapeRegExp(key)}=`, "m").test(envExampleText);

  return {
    id: `env-${key}`,
    title,
    status: hasKey ? "pass" : "fail",
    detail: hasKey ? `${key} is present in .env.example.` : `${key} is missing from .env.example.`
  };
}

function checkFile(
  existsValue: boolean,
  id: string,
  title: string,
  passDetail: string,
  missingDetail: string
): ReadinessCheck {
  const missingIsWarning = id.endsWith("dockerfile") || id === "dockerignore";

  return {
    id,
    title,
    status: existsValue ? "pass" : missingIsWarning ? "warn" : "fail",
    detail: existsValue ? passDetail : missingDetail
  };
}

function checkPublicDoc(publicDocs: string[], docName: string, title: string): ReadinessCheck {
  const hasDoc = publicDocs.includes(docName);

  return {
    id: `doc-${docName}`,
    title,
    status: hasDoc ? "pass" : "fail",
    detail: hasDoc ? `docs/public/${docName} exists.` : `docs/public/${docName} is missing.`
  };
}

function renderReport(checksToRender: ReadinessCheck[]): string {
  const summary = summarize(checksToRender);
  const lines = [
    "# P7 Deployment Readiness Report",
    "",
    `Generated at: ${new Date().toISOString()}`,
    "",
    "## Summary",
    "",
    `- Pass: ${summary.pass}`,
    `- Warn: ${summary.warn}`,
    `- Fail: ${summary.fail}`,
    "",
    "## Checks",
    "",
    "| Status | Check | Detail |",
    "|---|---|---|",
    ...checksToRender.map((check) => `| ${check.status} | ${check.title} | ${check.detail} |`),
    "",
    "## Interpretation",
    "",
    "- `pass` means the repository already has the expected deploy/test artifact.",
    "- `warn` means deployment can be planned, but the repo is not fully containerized yet.",
    "- `fail` means a required public configuration or command is missing.",
    "",
    "This report is local/private and should not be committed.",
    ""
  ];

  return lines.join("\n");
}

function summarize(checksToSummarize: ReadinessCheck[]) {
  return checksToSummarize.reduce(
    (counts, check) => ({
      ...counts,
      [check.status]: counts[check.status] + 1
    }),
    { pass: 0, warn: 0, fail: 0 }
  );
}

async function listPublicDocs(): Promise<string[]> {
  const docsDir = path.join(repoRoot, "docs/public");

  try {
    const entries = await fs.readdir(docsDir, { withFileTypes: true });

    return entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
  } catch {
    return [];
  }
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await readText(filePath)) as T;
}

async function readText(filePath: string): Promise<string> {
  return fs.readFile(filePath, "utf8");
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);

    return true;
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
