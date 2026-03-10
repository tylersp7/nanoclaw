---
name: user-profile
description: User profile and preferences
---

# User Profile

A user profile is maintained at `/workspace/group/user-profile.md` with interaction patterns, preferences, and statistics.

## Usage
- Read the profile at the start of conversations for context on user preferences
- The profile is automatically updated by the host system after each interaction
- Use the profile to tailor response style, verbosity, and topic focus

## File Location

The profile lives at `/workspace/group/user-profile.md` and is both human-readable and machine-parseable. The human-readable section at the top shows message patterns, preferences, and interaction stats. A JSON block at the bottom contains the full structured data.

## What It Tracks

- **Message patterns**: average message length, peak activity hours, active days of the week
- **Preferences**: response style (concise/detailed/technical), common topics, tool preferences
- **Interaction stats**: total messages, total sessions, last interaction date, average session length

## Notes

- The profile is updated automatically after each user interaction — do not write to it from the container
- Tyler can manually edit the human-readable section to override preferences (e.g., setting response style)
- If the file does not exist yet, the system will create it after the first interaction
