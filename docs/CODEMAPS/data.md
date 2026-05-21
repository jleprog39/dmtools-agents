<!-- Generated: 2026-05-19 | Token estimate: ~600 -->

# Data

No database. State lives in **Jira** (tickets, statuses, labels, custom fields) and **Git/GitHub** (branches, PRs, comments). Agent I/O passes through the local filesystem (`outputs/`, `input/`).

## Jira "schema" (logical)

| Concept | Where |
|---------|-------|
| Issue types | `js/config.js` → `ISSUE_TYPES` (Story, Bug, Task, Subtask, Test Case) |
| Statuses | `js/config.js` → `STATUSES` (Backlog, To Do, BA Analysis, Solution Architecture, Ready For Development, In Development, In Review, In Testing, Done, …) |
| Labels (locks/flags) | `js/config.js` → `LABELS`. Examples below. |
| Custom fields | `jira.fields` in `.dmtools/config.js` (deep-merged) — e.g. Acceptance Criteria field id |

### Label lifecycle (locks)
```
sm_<rule>_triggered     SM acquired lock (added by smAgent before dispatch)
ai_questions_asked      Story already had clarifying questions
q                       Subtask carries a question for PO
pr_approved             PR review passed → eligible for merge
wip / <ctx>_wip         Manual pause flag — SM skips ticket
```
Released by each agent's `postJS` (`releaseLock()` in jiraHelpers).

## Filesystem I/O (per agent run)

```
input/
  request.md         ← Jira ticket body (fetched by DMTools)
  comments.md        ← comment history
  questions.md       ← injected by fetchQuestionsToInput.js
  parent.md          ← injected by fetchParentContextToInput.js
  epics.md / linked_bugs.md / linked_tests.md
outputs/
  response.md        ← canonical AI output, parsed by aiResponseParser.js
  *_exit_code.txt    ← captured exit codes (bash_tools rules)
```

## Migrations

None. Schema evolution is per-project Jira admin work; config drift handled by `.dmtools/config.js` overrides (`jira.statuses` / `issueTypes` full-replace).

## Test fixtures
`js/unit-tests/` — pure in-memory mocks via `loadModule(path, requireFn, mocks)`. No fixture files on disk.
