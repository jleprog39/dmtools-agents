<!-- Generated: 2026-05-19 | Token estimate: ~550 -->

# Dependencies

No `package.json`. Runtime contract is the DMTools GraalJS environment + a set of external CLI/cloud services invoked via shell or DMTools MCP-style globals.

## Runtime
| Dep | Why | Pinned |
|-----|-----|--------|
| **DMTools CLI** | Host runtime — provides JSRunner, Teammate, TestCasesGenerator; injects globals (`jira_*`, `github_*`, `file_*`, …) | `setup/dmtools.sh` (default `v1.7.174`) |
| **GraalJS** (inside DMTools) | JS engine — constraints: `var` at module level, no arrow fns in framework code, no npm | — |
| **Java 17** | Required by DMTools | `setup/java.sh` |
| **Node 20** | Needed by some CLI providers (copilot via npx) | `setup/node.sh` |

## External services
| Service | Used by | Auth |
|---------|---------|------|
| **Jira** | All agents (read/write tickets, labels, comments, transitions) | DMTools env |
| **GitHub** | `github_*` globals, `ai-teammate.yml` dispatch, PR ops | `GITHUB_TOKEN` |
| **Azure DevOps** | Optional SCM provider (`js/common/scm.js` `ado` branch) | per-config |
| **Bitrise** | iOS builds, test automation triggers (`triggerBitrise*.js`) | env |
| **Confluence** | Optional via `confluence` config block | DMTools env |
| **Figma** | `dmtools figma_download_image_of_file` for design lookups | DMTools env |
| **Gemini** | `dmtools gemini_ai_chat_with_files` for image/PDF reading | DMTools env |

## AI CLI providers (selected by `AI_AGENT_PROVIDER`)
| Provider | Command | Env required |
|----------|---------|--------------|
| `cursor` (default) | `cursor-agent` | optional `CURSOR_MODEL` (default `auto`) |
| `copilot` | `copilot` or `npx @github/copilot@1.0.44` | `COPILOT_GITHUB_TOKEN` or `GITHUB_TOKEN`, optional `COPILOT_MODEL` (default `gpt-5-mini`) |
| `codemie` | `codemie-claude` | `CODEMIE_API_KEY`, `CODEMIE_BASE_URL`, optional `CODEMIE_MODEL` (default `claude-4-5-sonnet`), `CODEMIE_MAX_TURNS` (default 50) |

`scripts/run-agent.sh` is the single dispatch point. Final output always: `outputs/response.md`.

## Optional tools (`setup/install.sh`)
`java`, `node`, `dmtools`, `maestro` (mobile testing), `copilot`, `codemie`, `cursor`, `cache.sh`, `checkout.sh`.

Install order matters: `java` before `dmtools`, `node` before `copilot`.

## Submodule consumers
This repo is consumed as the `agents/` submodule by host repos. `js/common/submodules.js` manages nested submodule operations for those hosts.

## Internal cross-module map
```
smAgent.js ──► configLoader.js ──► config.js
            └► common/scm.js (lazy require, optional)
            └► jiraHelpers / githubHelpers globals (DMTools-provided)

all postJS ──► aiResponseParser.js (response.md → structured data)
            └► jiraHelpers.releaseLock()
            └► common/scm.js (PR ops)

unit-tests/testRunner.js ──► loadModule() shadow-injects globals
```
