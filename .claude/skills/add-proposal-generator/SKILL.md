---
name: add-proposal-generator
description: AI-powered proposal generator. Automatically creates tailored proposals for freelance jobs by analyzing job descriptions and matching with your experience.
---

# Add Proposal Generator

This skill sets up a proposal generation system for freelance opportunities. When a lead monitor finds a high-scoring opportunity, the agent can automatically generate a tailored proposal using your professional profile and templates.

## What It Does

- Stores your professional profile (skills, rates, portfolio, past projects)
- Provides proposal templates for different job types
- Gives the agent a CLI tool to load your profile and templates
- The agent (Claude) writes the actual proposal using the loaded context
- Stores generated proposals for tracking and reuse

## How It Integrates

The lead pipeline's follow-up detector fires on `<signal type="LEAD_FOUND">` and prompts the agent to "generate a tailored proposal if score >= 7". The agent calls `proposal-generator.sh generate <file>` which loads your profile and the best-matching template, then Claude writes the proposal using that context.

---

## Setup Steps

### Step 1: Gather Professional Profile

**USER ACTION REQUIRED**

Ask the user for their professional details:

> To generate great proposals, I need your professional profile. Please provide:
>
> 1. **Your name** (as you want it on proposals)
> 2. **Professional title** (e.g., "n8n Automation Specialist")
> 3. **Key skills** (comma-separated list)
> 4. **Hourly rate** (or rate range, e.g., "$75-150/hr")
> 5. **Portfolio URL** (website, GitHub, or LinkedIn)
> 6. **2-3 past projects** with brief descriptions and outcomes
> 7. **Availability** (e.g., "20 hrs/week", "Full-time", "Project-based")
> 8. **Timezone**

Wait for the user to provide this information before continuing.

### Step 2: Create Config Directory and Profile

```bash
mkdir -p ~/.nanoclaw-proposals/templates
chmod 700 ~/.nanoclaw-proposals
```

Create the profile using the information the user provided:

```bash
cat > ~/.nanoclaw-proposals/profile.json << 'PROFILE_EOF'
{
  "name": "USER_NAME",
  "title": "USER_TITLE",
  "skills": ["skill1", "skill2", "skill3"],
  "hourly_rate": "$XX-YY/hr",
  "portfolio_url": "https://example.com",
  "availability": "Available for project-based work",
  "timezone": "US Pacific",
  "past_projects": [
    {
      "name": "Project Name",
      "description": "What you built and why",
      "technologies": ["tech1", "tech2"],
      "outcome": "Measurable result"
    }
  ]
}
PROFILE_EOF
chmod 600 ~/.nanoclaw-proposals/profile.json
```

Replace all placeholder values with the user's actual information.

### Step 3: Install Default Templates

Copy the default templates from the project:

```bash
cp /Users/tyler/dev/nanoclaw/container/tools/templates/technical-automation.md ~/.nanoclaw-proposals/templates/
cp /Users/tyler/dev/nanoclaw/container/tools/templates/n8n-specialist.md ~/.nanoclaw-proposals/templates/
cp /Users/tyler/dev/nanoclaw/container/tools/templates/general-freelance.md ~/.nanoclaw-proposals/templates/
```

### Step 4: Verify Setup

```bash
# Check profile exists and is valid JSON
cat ~/.nanoclaw-proposals/profile.json | python3 -m json.tool > /dev/null && echo "Profile: OK"

# Check templates exist
ls ~/.nanoclaw-proposals/templates/*.md && echo "Templates: OK"

# Test the tool from a container context (dry run)
echo "Setup complete. The proposal-generator tool is available to agents."
```

### Step 5: Rebuild Container

```bash
cd /Users/tyler/dev/nanoclaw
container builder stop && container builder rm && container builder start
./container/build.sh
```

---

## Usage

### From the Agent (Inside Container)

The tool is at `/workspace/project/container/tools/proposal-generator.sh`.

**Generate a proposal from a job description file:**
```bash
# Save the job description to a file first
cat > /tmp/job.txt << 'EOF'
Need an n8n expert to automate our sales pipeline. Must integrate Salesforce, Slack, and Google Sheets. Budget $1500, timeline 2 weeks.
EOF

/workspace/project/container/tools/proposal-generator.sh generate /tmp/job.txt
```

This outputs your profile and best-matching template, formatted for Claude to write the actual proposal.

**List available templates:**
```bash
/workspace/project/container/tools/proposal-generator.sh list-templates
```

**Show your profile:**
```bash
/workspace/project/container/tools/proposal-generator.sh profile
```

**Save a generated proposal:**
```bash
/workspace/project/container/tools/proposal-generator.sh save "client-name" "proposal text here..."
```

### From WhatsApp

```
@Andy I found a job on Upwork: "Need n8n expert to automate sales pipeline.
Must integrate Salesforce, Slack, and Google Sheets. Budget $1500."
Generate a proposal for this.
```

The agent will:
1. Save the job description to a temp file
2. Run `proposal-generator.sh generate` to load your profile and templates
3. Write a tailored proposal using the template structure and your profile data
4. Send you the proposal for review

### Calendar-Aware Proposals

When generating proposals, the agent can check your calendar to set realistic timelines and suggest meeting times:

**Check capacity before committing to timelines:**
```bash
/workspace/project/container/tools/calendar-checker.sh capacity
```
Returns `high`, `medium`, `low`, or `full`. Use this to adjust proposed start dates and turnaround times in the proposal. For example, if capacity is "low", propose starting next week instead of immediately.

**Find a meeting time to include in the proposal:**
```bash
/workspace/project/container/tools/calendar-checker.sh next-slot 60
```
Returns the next available 60-minute slot. Include this in the proposal's "Next Steps" section, e.g., "I'm available for a kickoff call on [date] at [time]."

**Get full availability for flexible scheduling:**
```bash
/workspace/project/container/tools/calendar-checker.sh availability 14
```
Shows all available slots over the next 2 weeks with hours breakdown.

### Automatic Pipeline Integration

When the lead pipeline finds a lead scoring 7+, the follow-up detector triggers:
1. The `LEAD_FOUND` signal fires
2. The agent receives: "generate a tailored proposal if score >= 7"
3. The agent checks calendar capacity via `calendar-checker.sh capacity`
4. If capacity allows, calls `proposal-generator.sh generate` with the lead details
5. Claude writes the proposal with realistic timelines based on availability
6. The proposal is saved for tracking

---

## Customization

### Edit Your Profile

```bash
# Open profile for editing
nano ~/.nanoclaw-proposals/profile.json
```

### Add Custom Templates

Create a new `.md` file in `~/.nanoclaw-proposals/templates/`:

```bash
cat > ~/.nanoclaw-proposals/templates/my-custom-template.md << 'EOF'
# Template: My Custom Niche

## Keywords
keyword1, keyword2, keyword3

## Structure

### Introduction
{{client_name}}, I noticed your posting about {{project_title}}...

### Relevant Experience
...

### Proposed Approach
{{proposed_approach}}

### Timeline & Pricing
Rate: {{hourly_rate}}
...
EOF
```

The tool matches templates by scanning for keyword overlap with the job description.

### Review Past Proposals

Generated proposals are saved in the group workspace:
```bash
ls /workspace/group/proposals/
cat /workspace/group/proposals/YYYY-MM-DD-client-name.md
```

---

## Success Criteria

After setup, verify:
- `~/.nanoclaw-proposals/profile.json` exists with your real information
- `~/.nanoclaw-proposals/templates/` has at least 3 templates
- `proposal-generator.sh profile` shows your profile
- `proposal-generator.sh list-templates` shows available templates
- `proposal-generator.sh generate <file>` outputs profile + template context

---

Tell the user:

> Proposal Generator is set up! When leads come in from your monitors, I can automatically generate tailored proposals using your profile and templates.
>
> **What happens next:**
> - Leads scoring 7+ from any monitor will trigger proposal generation
> - I'll match the job to your best template and write a custom proposal
> - You review, tweak if needed, and send
>
> **Quick test:** Send me a job description and ask me to write a proposal for it.
>
> **Templates installed:**
> - Technical Automation (scripting, API, DevOps jobs)
> - n8n Specialist (n8n/workflow automation jobs)
> - General Freelance (catch-all for other jobs)
>
> You can add more templates anytime with `/customize`.
