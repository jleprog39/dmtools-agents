# Output contract

Create these files:

1. `outputs/response.md` - tracker comment. For Jira configs, use Jira wiki markup.
2. `outputs/pr_review.json` - structured review result.
3. `outputs/pr_review_general.md` - general PR comment in SCM-compatible Markdown.

`outputs/pr_review.json` schema:

```json
{
  "recommendation": "APPROVE|REQUEST_CHANGES|BLOCK",
  "summary": "One short paragraph",
  "prNumber": null,
  "prUrl": null,
  "generalComment": "outputs/pr_review_general.md",
  "resolvedThreadIds": [],
  "inlineComments": [
    {
      "path": "src/file.tsx",
      "line": 42,
      "startLine": 40,
      "side": "RIGHT",
      "comment": "outputs/pr_review_comments/comment-1.md",
      "severity": "BLOCKING|IMPORTANT|SUGGESTION"
    }
  ],
  "issueCounts": {
    "blocking": 0,
    "important": 0,
    "suggestions": 0
  }
}
```

Use `recommendation`, not `verdict`.
Counts must match reported issues.
Comment text goes in a `.md` file referenced by `comment` (a path), never inline in the JSON — code/regex backslashes break `JSON.parse` and the review is lost. The JSON holds only scalars, ids, and file paths.

