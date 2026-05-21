<!-- Generated: 2026-05-19 | Files scanned: 53 JS + 31 JSON | Token estimate: ~950 -->

# Backend (GraalJS scripts)

There are no HTTP routes — "backend" here means the JS executed by DMTools JSRunner / agent postJS hooks.

## Entry Points

| Entry | Purpose |
|-------|---------|
| `js/smAgent.js` | SM orchestrator — invoked by `sm.json` and `sm_merge.json` |
| `js/workflowFailureReporter.js` | Cron failure reporter (`workflow_failure_reporter.json`) |
| `js/dfManager.js` | Dark Factory submodule manager (`df_manager.json`) |
| `js/restoreDescription.js` | Restores Jira description (`restoreDescription.json`) |
| `js/unit-tests/testRunner.js` | Test harness, loaded by `run_*.json` configs |

## Rule → Config → Stage Pipeline

```
sm.json[rule].configFile  →  <stage>.json  →  preJS / cliPrompt / postJS  →  outputs/response.md
```

### Stage configs (31 total)
Grouped by pipeline:

```
story_questions  → po_refinement → story_ba_check → story_acceptance_criteria(s)
                → story_solution → story_description → story_development
                → pr_review → pr_rework → retry_merge → story_done_check
bug_creation → bug_to_fix_check → bug_development → pr_review → pr_rework
             → retry_merge → bug_done_check → bug_merged → bug_test_cases_generator
test_cases_generator → test_case_automation → pr_test_automation_review/rework → retry_merge_test
intake → task_done_check → solution_description → restoreDescription
sm / sm_merge / df_manager / workflow_failure_reporter (orchestration / utility)
```

## Pre/Post JS hooks (`js/`)

| preJS | Used by |
|-------|---------|
| `preCliDevelopmentSetup.js` | story_development, bug_development |
| `preCliSolutionSetup.js` | story_solution |
| `preCliReworkSetup.js` | pr_rework |
| `preCliTestAutomationSetup.js` | test_case_automation |
| `preCliTestReworkSetup.js` | pr_test_automation_rework |
| `preCliMobileTestAutomationSetup.js` | mobile test automation |
| `prepareBugCreationContext.js` | bug_creation |
| `preparePRForReview.js` / `prepareTestPRForReview.js` | pr_review, pr_test_automation_review |
| `intakePreAction.js` | intake |
| `fetch*ToInput.js` (5 files) | Pull Jira context into input.md |

| postJS | Used by |
|--------|--------|
| `developTicketAndCreatePR.js` / `developBugAndCreatePR.js` | development stages |
| `writeSolutionAndDiagrams.js` | story_solution |
| `postPRReviewComments.js` / `postTestReviewComments.js` | review stages |
| `pushReworkChanges.js` / `postTestReworkResults.js` | rework stages |
| `postTestAutomationResults.js` / `postMobileTestAutomationResults.js` | test automation |
| `assignForReview.js` / `assignForSolutionArchitecture.js` | role transitions |
| `createQuestionsAndAssignForReview.js` | story_questions |
| `createPlannedStoriesFromOutput.js` | intake |
| `createSolutionDesignTicketsAndAssignForReview.js` | solution_description |
| `createIntakeTickets.js` | intake |
| `enhanceSDAPIDescriptionAndAssess.js` / `enhanceSolutionDesignDescriptionAndAssess.js` | enhancement |
| `closeQuestionTicket.js` | po_refinement |
| `notifyBugMerged.js` | bug_merged |
| `postBugCreation.js` | bug_creation |
| `retryMergePR.js` | retry_merge, retry_merge_test |
| `moveToDone.js` / `moveToInTesting.js` / `moveToReadyForTesting.js` | status transitions |
| `checkBugTestsPassed.js` / `checkStoryTestsPassed.js` / `checkBugToFixReady.js` | gating checks |
| `checkSubtasksDoneForBA.js` / `checkTaskStoriesDone.js` / `checkWipLabel.js` | localExecution rules |
| `checkoutBranch.js` | branch setup |
| `triggerBitriseIosBuild.js` / `triggerBitriseTestAutomation.js` | external CI triggers |

## Shared library (`js/common/`)
| File | Lines | Role |
|------|-------|------|
| `scm.js` | ~700 | SCM provider factory (`github` \| `ado`); PR/branch/comment API |
| `githubHelpers.js` | ~800 | GitHub-specific helpers (PRs, comments, files, workflows) |
| `jiraHelpers.js` | ~110 | Jira utilities (status transitions, label ops) |
| `pullRequest.js` | ~260 | PR creation/update helpers |
| `submodules.js` | ~300 | Git submodule operations |
| `feedbackLoop.js` | ~290 | Iterative correction loop for AI output |
| `autoStart.js` | ~200 | Auto-start workflow helper |
| `aiResponseParser.js` | ~55 | Parses `outputs/response.md` |

Top-level `common/` (separate, dmtools-callable): `aiResponseParser.js`, `jiraHelpers.js`.

## Branch Naming
`js/branchNaming/issueType_naming.js` — issue-type-based branch prefix rules.

## Config / Bootstrap
- `js/config.js` — STATUSES, LABELS, ISSUE_TYPES constants
- `js/configLoader.js` — discovers `.dmtools/config.js`, merges with defaults
  - Full-replace keys: `jira.statuses/issueTypes/questions`, `labels`, `smRules`, `smMergeRules`, `additionalInstructions`, `instructionOverrides`, `cliPrompts`, `cliPromptOverrides`, `agentParamPatches`, `jobParamPatches`
  - Deep-merge keys: `repository`, `git`, `formats`, `confluence`, `jira.fields`
