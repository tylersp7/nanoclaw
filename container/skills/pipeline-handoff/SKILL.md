# Pipeline Handoff

When you are operating as a step in a multi-step pipeline (your prompt contains `{prev_results}` or `{step_N_output}` references, or you're told you're in a pipeline), format your output for clean handoff to the next step.

## Detecting Pipeline Context

You're in a pipeline when:
- Your prompt includes output from previous steps
- Your prompt references step numbers or pipeline context
- You're explicitly told you're part of a pipeline

## Handoff Formats

Use the appropriate format based on your step's outcome:

### Standard Handoff
When your step completed successfully:
```
## Step: [Your Step Name]
### Context
[1-2 sentence summary of what was analyzed/done and key constraints]

### Deliverables
[Your main output — findings, data, recommendations, etc.]

### Quality Notes
- Confidence: [high/medium/low] — [why]
- Data gaps: [anything you couldn't verify or access]
- Assumptions: [any assumptions made]

### For Next Step
[Specific guidance for the next step in the pipeline — what to focus on, what to watch for]
```

### QA Pass
When you're validating another step's output and it passes:
```
## QA: PASS
### Verified
- [Criterion 1]: [evidence]
- [Criterion 2]: [evidence]

### Notes
[Any observations that don't block but are worth noting]
```

### QA Fail
When you're validating another step's output and it fails:
```
## QA: FAIL
### Issues
1. [Specific issue]: [what's wrong and why it matters]
2. [Specific issue]: [what's wrong and why it matters]

### Required Fixes
1. [Actionable fix for issue 1]
2. [Actionable fix for issue 2]

### Retry Guidance
[What the original step should do differently on retry]
```

### Escalation
When a step has been retried maximum times and still fails:
```
## ESCALATION
### Root Cause
[Why this step keeps failing]

### Attempts
- Attempt 1: [what happened]
- Attempt N: [what happened]

### Best Available Output
[The best result from all attempts, even if imperfect]

### Human Action Needed
[What a human needs to do to unblock this]
```

## Rules
- Always include your step name so downstream steps know the source
- Keep context summaries short — the next step has the full pipeline state
- Be explicit about confidence levels and data gaps
- In QA roles, cite specific evidence for pass/fail decisions
- Never pad output to look more complete — flag gaps honestly
