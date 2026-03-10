# Pre-Flight Check

Before starting complex tasks, consult learning artifacts for relevant context. This helps avoid known pitfalls and leverage proven approaches.

## When to Run Pre-Flight

DO run pre-flight for:
- Multi-step tasks (pipelines, investigations, deployments)
- Tasks involving external services (APIs, VPS, databases)
- Tasks that have failed before or seem risky
- New task types you haven't done for this group before

DO NOT run pre-flight for:
- Simple questions or greetings
- Quick lookups or status checks
- Follow-up messages in an ongoing conversation
- Tasks where speed matters more than caution (urgent alerts)

## Pre-Flight Checklist

Read these files from `/workspace/group/` (skip any that don't exist):

### 1. Check failure-patterns.md
- Does the current task match any known failure categories?
- If yes: note the recovery hint and plan around it
- Example: if doing API work and "rate_limit" pattern exists → add delays proactively

### 2. Check lessons.md
- Any "avoidance" lessons relevant to this task type?
- Any "approach" lessons that suggest a proven method?
- Any "preference" lessons about how the user wants results formatted?

### 3. Check skill-effectiveness.md
- Which skills have high success rates for similar work?
- Are there unused skills that might help?
- Avoid relying heavily on skills with low success rates

## How to Report

Keep it brief — 1-3 sentences max, integrated naturally into your response:

**Good**: "Before starting, I checked past patterns — API rate limits have been an issue before, so I'll add delays between calls. The SSH relay approach worked well last time for VPS tasks."

**Bad**: (Don't do a full formal report)
"PRE-FLIGHT CHECK COMPLETE. Failure patterns: 3 found. Lessons: 5 applicable. Skills: 2 recommended..."

The goal is informed action, not ceremony. If nothing relevant is found, don't mention the check at all — just proceed normally.

## As Context Grows

The pre-flight check becomes more valuable over time as learning artifacts accumulate. In early days with little data, most checks will find nothing — that's fine. The habit ensures the agent benefits as the knowledge base grows.
