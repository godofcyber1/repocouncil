# RepoCouncil Architecture

RepoCouncil combines deterministic GitHub integration with a LangGraph.js multi-agent review workflow.

## Flow

```mermaid
flowchart LR
    PR["GitHub PR"] --> WH["Webhook Receiver"]
    WH --> RUN["Review Run"]
    RUN --> CTX["Context Builder"]
    CTX --> LG["LangGraph.js"]
    LG --> PLAN["Planner"]
    PLAN --> SEC["Security"]
    PLAN --> QUAL["Quality"]
    PLAN --> TEST["Test"]
    SEC --> REF["Referee"]
    QUAL --> REF
    TEST --> REF
    REF --> GH["Checks API + Review Comments"]
    REF --> UI["Dashboard"]
```

## Principles

- Agents are read-only by default.
- Patch and test suggestions are advisory.
- Evidence-backed findings outrank unsupported model guesses.
- Output should be concise enough for a real pull request.
- Secrets and private notes stay outside GitHub.
