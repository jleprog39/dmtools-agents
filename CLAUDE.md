# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

`dmtools-agents` is a library of configs, prompts, and GraalJS scripts that drive an AI-powered Scrum Master pipeline on top of [DMTools](https://github.com/IstiN/dmtools). It is typically consumed as a **git submodule** mounted at `agents/` in a host repo. Nothing here is a Node app — there is **no `package.json`** and JS runs inside DMTools' GraalJS environment, not Node. Do not add `npm`/`node_modules` workflows.

The full architecture, pipeline diagrams (Story / Bug / Test Case), label lifecycle, and per-config reference live in `README.md`. Read it before editing rule wiring or designing new agents.

## Common commands

All commands run via the `dmtools` CLI. Configs are JSON files at repo root and inside `js/unit-tests/`. From the host repo (where this is mounted as `agents/`):

```bash
# Run the SM orchestrator (scans Jira, dispatches/locally-executes per-rule actions)
dmtools run agents/sm.json

# Run a single agent config (Teammate / TestCasesGenerator / JSRunner)
dmtools run agents/story_questions.json
dmtools run agents/pr_review.json

# Run a specific agent script (CLI provider selected by AI_AGENT_PROVIDER env)
agents/scripts/run-agent.sh "your prompt here"
AI_AGENT_PROVIDER=copilot agents/scripts/run-agent.sh "..."   # cursor | codemie | copilot

# Install host-side tooling (java, node, dmtools, cursor, copilot, codemie, maestro)
agents/setup/install.sh all
agents/setup/install.sh dmtools node copilot
agents/setup/install.sh all -cursor -codemie       # all except listed
```

### Unit tests

Tests run inside GraalJS via DMTools' JSRunner — there is no `jest`/`mocha`. Test files use globals (`test`, `suite`, `assert`, `loadModule`, `makeRequire`) provided by `js/unit-tests/testRunner.js`.

```bash
# All tests
dmtools run agents/js/unit-tests/run_all.json

# Single module's tests (one run_*.json per target file)
dmtools run agents/js/unit-tests/run_smAgent.json
dmtools run agents/js/unit-tests/run_configLoader.json
```

To add a new test: create `js/unit-tests/test_<module>.js`, then add it to the `testFiles` array in a `run_*.json`. See `js/unit-tests/README.md` for the mocking API.

## Architecture — the parts that span multiple files

### SM orchestration loop (`js/smAgent.js` + `sm.json`)

`sm.json` is a `JSRunner` config that invokes `js/smAgent.js` with a list of **rules**. Each rule has a `jql`, a `configFile` to dispatch, and label-based locking (`skipIfLabel`/`skipIfLabels` + `addLabel`). On every run (typically every 20 min via GitHub Actions), for each matching Jira ticket SM either:

- **Dispatches** `ai-teammate.yml` via `workflow_dispatch` with `config_file` + `concurrency_key` inputs (default, async, AI-heavy work), or
- **Executes locally** when `localExecution: true` is set on the rule — runs the config's `postJS` directly inside the SM process (fast/safe checks like merge-readiness, subtask-done checks).

Locking is distributed via Jira labels: SM stamps `addLabel` before dispatch; the agent's `postJS` must call `releaseLock()` on completion. The `wip` (or `<contextId>_wip`) label manually pauses processing on a ticket.

`maxTriggeredWorkflows` (or `jobParams.maxWorkflowsPerRun`) caps non-local dispatches per run. Override via `config.smMaxWorkflows` in the host project's `.dmtools/config.js`.

### Three agent types

Defined by the top-level `"name"` in each `*.json` config:

| `name` | Runs | Used for |
|--------|------|----------|
| `Teammate` | CLI agent (`scripts/run-agent.sh` → cursor / copilot / codemie) with a markdown prompt | Development, review, design, refinement — anything LLM-heavy. `skipAI: true` means DMTools doesn't call its own LLM; the CLI tool does. |
| `TestCasesGenerator` | DMTools job that emits Test Case Jira tickets | Test case generation |
| `JSRunner` | Pure JS (no AI) at `jsPath` | `smAgent.js`, `workflowFailureReporter.js`, all `postJS` actions, unit tests |

### Project configuration (`js/configLoader.js`)

Per-host-repo config lives in **`.dmtools/config.js` at the host repo root** (not in this submodule). `configLoader` discovers it via: explicit `customParams.configPath` → `../.dmtools/config.js` → built-in defaults.

Merge semantics matter — get them wrong and you'll silently lose defaults:

- **Full replacement when provided**: `jira.statuses`, `jira.issueTypes`, `jira.questions`, `labels`, `smRules`, `smMergeRules`, `additionalInstructions`, `instructionOverrides`, `cliPrompts`, `cliPromptOverrides`, `agentParamPatches`, `jobParamPatches`
- **Deep merge**: `repository`, `git`, `formats`, `confluence`, `jira.fields`

`{jiraProject}` and `{parentTicket}` in rule JQLs are interpolated from `jira.project` / `jira.parentTicket`. `repository.owner`/`repo` from config override `sm.json` defaults.

Multi-project repos use the `agentConfigsDir` pattern (per-folder configs under e.g. `projects/ALPHA/`) — see `.github/skills/dmtools-agents/SKILL.md` for the full multi-project setup.

### Agent config anatomy

Most `*.json` configs are `Teammate` configs that reference:
- `cliPrompt` — markdown file under `prompts/`
- `additionalInstructions` — file list pulled from `instructions/<area>/` (e.g. `instructions/common/`, `instructions/story/`, `instructions/review/`)
- `preJS` / `postJS` — JS hooks under `js/` (preCli setup, postX result processing, label release, status transitions)

When changing a workflow stage, the change usually touches: the `*.json` config (wiring), a `prompts/*.md` file (LLM behavior), one or more `instructions/**/*.md` files (shared rules), and possibly `pre*`/`post*` JS in `js/`.

### Pipelines

Three pipelines all defined in `sm.json` rules and rendered as diagrams in `README.md`:

1. **Story**: Backlog → Questions → PO Refinement → BA Analysis (Acceptance Criteria) → Solution Architecture → Ready For Development → In Review (PR Review / Rework) → Done
2. **Bug**: Backlog → Bug Development → In Review → Done (with `bug_to_fix_check`, `bug_done_check`, `bug_merged` checkpoints)
3. **Test Case**: generation via `TestCasesGenerator`, automation via `test_case_automation.json`, review/rework via `pr_test_automation_*`

`sm_merge.json` is a separate JSRunner config for the merge phase (retry-merge, post-merge notifications).

## GraalJS gotchas (when editing `js/`)

- Use `var` at module level (not `const`/`let`) — safer for top-level GraalJS scope.
- Avoid arrow functions in framework/loader code; test bodies are fine.
- DMTools MCP tools (`jira_search_by_jql`, `file_read`, `github_trigger_workflow`, `jira_post_comment`, …) are available as **globals**, not imports. Tests shadow them via `loadModule(path, requireFn, mocks)`.
- `require()` works for repo-relative paths (`./configLoader.js`, `./common/scm.js`); there is no npm resolution. Lazy/optional dependencies are wrapped in `try { require(...) } catch (e) {}`.

## Bash-tool rules for agents (also relevant when running commands here)

From `instructions/common/bash_tools.md` — these apply to anything an agent script (or you) executes via DMTools' bash tool:

- Never end commands with `exit` (kills the shell session).
- Capture exit code via `$?` immediately, before the next command.
- Avoid `$PIPESTATUS` with pipes — redirect to a file instead:
  ```bash
  mkdir -p outputs
  pytest path/to/test.py -q -r a > outputs/pytest_output.txt 2>&1
  echo $? > outputs/pytest_exit_code.txt
  ```

## Other things to know

- **`outputs/response.md`** is the canonical agent output file. `run-agent.sh` and most prompts assume this path.
- **CLI provider** is selected by `AI_AGENT_PROVIDER` (`cursor` default, `copilot`, `codemie`). Each provider needs its own auth (`COPILOT_GITHUB_TOKEN`/`GITHUB_TOKEN`, `CODEMIE_API_KEY` + `CODEMIE_BASE_URL`, optional `CURSOR_MODEL`).
- **`scripts/simple-test.sh`** is a no-LLM smoke script used to debug the GitHub Actions wiring — it just touches `README.md` and writes `outputs/response.md`.
- **`.github/skills/`** contains domain-specific SKILL.md docs (`dmtools-agents`, `df-manager`, `scm-abstraction`, `setup-dark-factory`, `agent-prompt-architecture`) — load the relevant one when working on that area.
