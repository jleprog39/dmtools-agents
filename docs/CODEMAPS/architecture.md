<!-- Generated: 2026-05-19 | Files scanned: ~140 | Token estimate: ~700 -->

# Architecture

## Project Type
Library / submodule — no `package.json`. JS runs in **DMTools GraalJS**, not Node. Mounted as `agents/` in a host repo.

## High-Level Flow

```
GitHub Actions (cron 20m)        Host repo (.dmtools/config.js)
        │                               │
        ▼                               ▼
  sm.json (JSRunner) ── loads ──> configLoader.js
        │                               │
        ▼                               ▼
   smAgent.js  ──── for each rule ──────┤
        │                               │
        ├── JQL → Jira ─────────────────┤
        │                               │
        ├── localExecution=true ──> run postJS in-process
        │
        └── dispatch ai-teammate.yml ──> Teammate config
                                          │
                                          ├── preJS (setup)
                                          ├── run-agent.sh (cursor|copilot|codemie)
                                          │     reads prompts/*.md + instructions/**
                                          │     writes outputs/response.md
                                          └── postJS (parse, post comments, release lock)
```

## Service Boundaries

| Boundary | Lives in | Purpose |
|----------|----------|---------|
| SM orchestrator | `sm.json` + `js/smAgent.js` | Jira polling, label locking, dispatch |
| Merge orchestrator | `sm_merge.json` + smAgent | Post-approval merge phase |
| Per-stage agent | `*.json` + `prompts/*.md` + `instructions/<area>/` | One pipeline step |
| CLI runner | `scripts/run-agent.sh` | Invokes cursor/copilot/codemie |
| SCM abstraction | `js/common/scm.js` | github / ado provider factory |
| Config | `js/configLoader.js` + host `.dmtools/config.js` | Project-specific overrides |
| Tests | `js/unit-tests/` via JSRunner | GraalJS-native test harness |

## Three Pipelines (defined as rules in sm.json)
- **Story**: Backlog → Questions → PO Refinement → BA Analysis → Solution Architecture → Ready For Development → In Review → Done
- **Bug**: Backlog → Bug Development → In Review → Done
- **Test Case**: generation → automation → review/rework

## Agent Types
| `"name"` field | Executor |
|----------------|----------|
| `Teammate` | `run-agent.sh` + markdown prompt (skipAI=true; AI driven by CLI tool) |
| `TestCasesGenerator` | DMTools native job |
| `JSRunner` | Pure JS at `jsPath` (no AI) |

## Locking
Distributed via Jira labels: `addLabel` stamped pre-dispatch, `postJS` calls `releaseLock()`. Manual `wip` label pauses processing.
