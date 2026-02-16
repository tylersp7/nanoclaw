---
name: add-proposal-generator
description: AI-powered proposal generator using Claude API. Automatically creates tailored proposals for freelance jobs by analyzing job descriptions and matching with your experience. Saves hours per week on proposal writing.
---

# Add Proposal Generator

This skill uses Claude AI to automatically generate professional, tailored proposals for freelance opportunities. Analyzes job postings and creates customized responses highlighting your relevant experience.

## What It Does

**Automatic Proposal Generation:**
- Analyzes job description
- Identifies key requirements
- Matches with your skills/experience
- Generates customized proposal
- Includes relevant portfolio examples
- Suggests pricing based on complexity

**Template Management:**
- Stores successful proposal templates
- Learns from your style
- Adapts to different job types
- Maintains your voice

**Smart Customization:**
- References specific requirements
- Highlights relevant projects (BeastMode, Auto Blogger)
- Adjusts tone for platform (Upwork vs LinkedIn)
- Includes appropriate CTAs

---

## Installation

### 1. Get Claude API Key

**USER ACTION REQUIRED**

Tell the user:

> We'll use the Claude API (Anthropic) to generate proposals. You need an API key:
>
> 1. Go to https://console.anthropic.com/
> 2. Sign up or log in
> 3. Go to **API Keys** in the left sidebar
> 4. Click **Create Key**
> 5. Name it: "NanoClaw Proposal Generator"
> 6. Copy the key (starts with `sk-ant-`)
>
> Note: You'll pay per API call. Generating a proposal costs ~$0.10-0.30 depending on length. Very affordable!

### 2. Store API Key

```bash
mkdir -p ~/.nanoclaw-proposals
chmod 700 ~/.nanoclaw-proposals

cat > ~/.nanoclaw-proposals/config.json << 'EOF'
{
  "anthropicApiKey": "sk-ant-YOUR_KEY_HERE",
  "model": "claude-3-5-sonnet-20241022",
  "maxTokens": 2000
}
EOF

chmod 600 ~/.nanoclaw-proposals/config.json
```

### 3. Create Your Profile

```bash
cat > ~/.nanoclaw-proposals/profile.json << 'EOF'
{
  "name": "Tyler",
  "title": "n8n Automation Specialist | VPS & Security Expert",
  "skills": [
    "n8n workflow automation",
    "API integration",
    "VPS deployment and management",
    "Python automation",
    "JavaScript/Node.js",
    "Security automation",
    "Bug bounty platforms",
    "Docker/containerization",
    "CI/CD pipelines",
    "Slack/webhook integrations"
  ],
  "experience": [
    {
      "name": "BeastMode - Automated Bug Bounty Platform",
      "description": "Built comprehensive security automation system with 40+ modules for recon, vulnerability scanning, and reporting. Deployed on VPS with Slack integration for real-time alerts.",
      "technologies": ["Python", "VPS", "Slack API", "Docker", "Cron automation"],
      "outcomes": ["24/7 automated scanning", "Real-time vulnerability alerts", "Comprehensive HTML reports"]
    },
    {
      "name": "Auto Blogger - AI Content Pipeline",
      "description": "Developed multi-LLM blog generation platform with writer/judge/revise workflow. Produces 2 posts per week per topic with quality control and WordPress publishing.",
      "technologies": ["Node.js", "TypeScript", "Claude/GPT-4/Gemini APIs", "Prisma", "BullMQ", "PostgreSQL"],
      "outcomes": ["Automated content generation", "Quality-controlled output", "Scheduled publishing", "Multiple site management"]
    }
  ],
  "rates": {
    "hourly": {
      "minimum": 75,
      "preferred": 100,
      "maximum": 150
    },
    "fixed": {
      "small": "500-1000",
      "medium": "1000-3000",
      "large": "3000-10000"
    }
  },
  "availability": "Available for both hourly and project-based work",
  "timezone": "US Pacific",
  "responseTime": "Within 24 hours"
}
EOF
```

Edit with your actual details!

### 4. Install Anthropic SDK

```bash
cd /Users/tyler/dev/nanoclaw
npm install @anthropic-ai/sdk
```

---

## Implementation

### 5. Create Proposal Generator Helper

```typescript
// src/proposal-generator.ts
import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import path from 'path';
import os from 'os';

interface ProposalConfig {
  anthropicApiKey: string;
  model: string;
  maxTokens: number;
}

interface UserProfile {
  name: string;
  title: string;
  skills: string[];
  experience: Array<{
    name: string;
    description: string;
    technologies: string[];
    outcomes: string[];
  }>;
  rates: {
    hourly: { minimum: number; preferred: number; maximum: number };
    fixed: { small: string; medium: string; large: string };
  };
  availability: string;
  timezone: string;
  responseTime: string;
}

interface JobDetails {
  title: string;
  description: string;
  budget?: string;
  platform: string;
  skills?: string[];
  clientInfo?: string;
}

interface GeneratedProposal {
  proposal: string;
  estimatedPrice?: string;
  estimatedTime?: string;
  confidence: string;
  keyPoints: string[];
}

let anthropicClient: Anthropic | null = null;

function loadConfig(): ProposalConfig {
  const configPath = path.join(os.homedir(), '.nanoclaw-proposals', 'config.json');
  if (!fs.existsSync(configPath)) {
    throw new Error('Proposal generator config not found. Run /add-proposal-generator');
  }
  return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
}

function loadProfile(): UserProfile {
  const profilePath = path.join(os.homedir(), '.nanoclaw-proposals', 'profile.json');
  if (!fs.existsSync(profilePath)) {
    throw new Error('Profile not found. Create ~/.nanoclaw-proposals/profile.json');
  }
  return JSON.parse(fs.readFileSync(profilePath, 'utf-8'));
}

function getClient(): Anthropic {
  if (anthropicClient) return anthropicClient;

  const config = loadConfig();
  anthropicClient = new Anthropic({ apiKey: config.anthropicApiKey });
  return anthropicClient;
}

/**
 * Generate a proposal for a job posting
 */
export async function generateProposal(
  job: JobDetails,
  options?: {
    tone?: 'professional' | 'friendly' | 'technical';
    length?: 'short' | 'medium' | 'long';
    includePrice?: boolean;
  }
): Promise<GeneratedProposal> {
  const client = getClient();
  const config = loadConfig();
  const profile = loadProfile();

  const tone = options?.tone || 'professional';
  const length = options?.length || 'medium';
  const includePrice = options?.includePrice ?? true;

  const prompt = `You are helping a freelance automation specialist write a compelling proposal for a job posting.

USER PROFILE:
Name: ${profile.name}
Title: ${profile.title}
Skills: ${profile.skills.join(', ')}

RELEVANT EXPERIENCE:
${profile.experience.map(exp => `
- ${exp.name}: ${exp.description}
  Technologies: ${exp.technologies.join(', ')}
  Outcomes: ${exp.outcomes.join(', ')}
`).join('\n')}

RATES:
Hourly: $${profile.rates.hourly.preferred}/hr (range: $${profile.rates.hourly.minimum}-${profile.rates.hourly.maximum})
Fixed Project: ${profile.rates.fixed.small} (small), ${profile.rates.fixed.medium} (medium), ${profile.rates.fixed.large} (large)

JOB POSTING:
Title: ${job.title}
Platform: ${job.platform}
${job.budget ? `Budget: ${job.budget}` : ''}
${job.skills ? `Required Skills: ${job.skills.join(', ')}` : ''}
${job.clientInfo ? `Client: ${job.clientInfo}` : ''}

Description:
${job.description}

INSTRUCTIONS:
Write a ${length} proposal (${length === 'short' ? '150-250' : length === 'medium' ? '250-400' : '400-600'} words) with a ${tone} tone.

The proposal should:
1. Show you understand their specific needs (reference details from their post)
2. Highlight 1-2 relevant experiences from the profile
3. Mention specific technologies/skills that match
4. Be conversational but professional
5. Include a clear call-to-action
${includePrice ? '6. Suggest a price/timeline based on complexity' : ''}

Format your response as JSON:
{
  "proposal": "The full proposal text",
  "estimatedPrice": "Suggested pricing with brief justification",
  "estimatedTime": "Estimated timeline",
  "confidence": "high/medium/low - your confidence this matches their needs",
  "keyPoints": ["Key point 1", "Key point 2", "Key point 3"]
}

Keep the proposal natural - avoid corporate jargon, buzzwords, or overly formal language. Write like a real human reaching out to help.`;

  const response = await client.messages.create({
    model: config.model,
    max_tokens: config.maxTokens,
    messages: [
      {
        role: 'user',
        content: prompt,
      },
    ],
  });

  const content = response.content[0];
  if (content.type !== 'text') {
    throw new Error('Unexpected response type from Claude');
  }

  // Parse JSON response
  const result = JSON.parse(content.text);
  return result;
}

/**
 * Generate multiple proposal variations
 */
export async function generateProposalVariations(
  job: JobDetails,
  count: number = 3
): Promise<GeneratedProposal[]> {
  const variations = await Promise.all([
    generateProposal(job, { tone: 'professional', length: 'medium' }),
    generateProposal(job, { tone: 'friendly', length: 'short' }),
    generateProposal(job, { tone: 'technical', length: 'long' }),
  ]);

  return variations.slice(0, count);
}

/**
 * Improve an existing proposal
 */
export async function improveProposal(
  originalProposal: string,
  feedback: string
): Promise<string> {
  const client = getClient();
  const config = loadConfig();

  const prompt = `You are helping improve a freelance proposal.

ORIGINAL PROPOSAL:
${originalProposal}

FEEDBACK:
${feedback}

Please rewrite the proposal incorporating the feedback while maintaining a natural, professional tone.`;

  const response = await client.messages.create({
    model: config.model,
    max_tokens: config.maxTokens,
    messages: [
      {
        role: 'user',
        content: prompt,
      },
    ],
  });

  const content = response.content[0];
  if (content.type !== 'text') {
    throw new Error('Unexpected response type');
  }

  return content.text;
}

/**
 * Analyze a job for fit before generating proposal
 */
export async function analyzeJobFit(job: JobDetails): Promise<{
  score: number;
  strengths: string[];
  concerns: string[];
  recommendation: string;
}> {
  const client = getClient();
  const config = loadConfig();
  const profile = loadProfile();

  const prompt = `Analyze how well this job matches the freelancer's profile.

USER SKILLS: ${profile.skills.join(', ')}

JOB:
${job.title}
${job.description}
${job.skills ? `Required: ${job.skills.join(', ')}` : ''}

Rate the match 1-10 and explain:
- Strengths (what matches well)
- Concerns (what might be challenging)
- Recommendation (should they apply?)

Format as JSON:
{
  "score": 8,
  "strengths": ["strength 1", "strength 2"],
  "concerns": ["concern 1"],
  "recommendation": "Strong match, recommend applying"
}`;

  const response = await client.messages.create({
    model: config.model,
    max_tokens: 1000,
    messages: [{ role: 'user', content: prompt }],
  });

  const content = response.content[0];
  if (content.type !== 'text') {
    throw new Error('Unexpected response type');
  }

  return JSON.parse(content.text);
}

/**
 * Format proposal for WhatsApp
 */
export function formatProposalForWhatsApp(proposal: GeneratedProposal): string {
  return `*GENERATED PROPOSAL*

${proposal.proposal}

---

*Suggested Pricing:* ${proposal.estimatedPrice || 'Not specified'}
*Estimated Time:* ${proposal.estimatedTime || 'Not specified'}
*Confidence:* ${proposal.confidence}

*Key Points:*
${proposal.keyPoints.map(point => `• ${point}`).join('\n')}

---
Edit as needed before sending!`;
}

/**
 * Save successful proposal as template
 */
export function saveTemplate(
  name: string,
  proposal: string,
  jobType: string
): void {
  const templatesDir = path.join(os.homedir(), '.nanoclaw-proposals', 'templates');
  fs.mkdirSync(templatesDir, { recursive: true });

  const template = {
    name,
    jobType,
    proposal,
    savedAt: new Date().toISOString(),
  };

  const templateFile = path.join(templatesDir, `${name.replace(/\s+/g, '-').toLowerCase()}.json`);
  fs.writeFileSync(templateFile, JSON.stringify(template, null, 2));
}
```

Save to `src/proposal-generator.ts`.

### 6. Create CLI Tool

```bash
cat > /Users/tyler/dev/nanoclaw/container/tools/proposal-generator.sh << 'EOF'
#!/bin/bash
# Proposal generator tool

NANOCLAW_DIR="/workspace/project"

case "$1" in
  generate)
    JOB_TITLE="$2"
    JOB_DESC="$3"
    PLATFORM="${4:-upwork}"

    if [ -z "$JOB_TITLE" ] || [ -z "$JOB_DESC" ]; then
      echo "Usage: proposal-generator.sh generate 'title' 'description' [platform]"
      exit 1
    fi

    node -e "
    const { generateProposal, formatProposalForWhatsApp } = require('$NANOCLAW_DIR/dist/proposal-generator.js');

    const job = {
      title: '$JOB_TITLE',
      description: '$JOB_DESC',
      platform: '$PLATFORM'
    };

    generateProposal(job).then(proposal => {
      console.log(formatProposalForWhatsApp(proposal));
    }).catch(err => console.error('Error:', err.message));
    "
    ;;

  analyze)
    JOB_TITLE="$2"
    JOB_DESC="$3"

    if [ -z "$JOB_TITLE" ] || [ -z "$JOB_DESC" ]; then
      echo "Usage: proposal-generator.sh analyze 'title' 'description'"
      exit 1
    fi

    node -e "
    const { analyzeJobFit } = require('$NANOCLAW_DIR/dist/proposal-generator.js');

    const job = {
      title: '$JOB_TITLE',
      description: '$JOB_DESC',
      platform: 'upwork'
    };

    analyzeJobFit(job).then(analysis => {
      console.log('*JOB FIT ANALYSIS*');
      console.log('Score:', analysis.score + '/10');
      console.log('\\nStrengths:');
      analysis.strengths.forEach(s => console.log('  +', s));
      console.log('\\nConcerns:');
      analysis.concerns.forEach(c => console.log('  -', c));
      console.log('\\nRecommendation:', analysis.recommendation);
    }).catch(err => console.error('Error:', err.message));
    "
    ;;

  variations)
    JOB_TITLE="$2"
    JOB_DESC="$3"

    if [ -z "$JOB_TITLE" ] || [ -z "$JOB_DESC" ]; then
      echo "Usage: proposal-generator.sh variations 'title' 'description'"
      exit 1
    fi

    node -e "
    const { generateProposalVariations } = require('$NANOCLAW_DIR/dist/proposal-generator.js');

    const job = {
      title: '$JOB_TITLE',
      description: '$JOB_DESC',
      platform: 'upwork'
    };

    generateProposalVariations(job, 3).then(variations => {
      variations.forEach((proposal, i) => {
        console.log(\`\\n=== VARIATION \${i + 1} ===\\n\`);
        console.log(proposal.proposal);
        console.log('\\nConfidence:', proposal.confidence);
      });
    }).catch(err => console.error('Error:', err.message));
    "
    ;;

  *)
    echo "Usage: proposal-generator.sh <command> [args]"
    echo ""
    echo "Commands:"
    echo "  generate 'title' 'description' [platform]  - Generate proposal"
    echo "  analyze 'title' 'description'              - Analyze job fit"
    echo "  variations 'title' 'description'           - Generate 3 versions"
    echo ""
    echo "Examples:"
    echo "  proposal-generator.sh generate 'n8n Automation Expert' 'Need help with...'"
    echo "  proposal-generator.sh analyze 'API Integration' 'Looking for...'"
    ;;
esac
EOF

chmod +x /Users/tyler/dev/nanoclaw/container/tools/proposal-generator.sh
```

### 7. Update Group CLAUDE.md

Add to `groups/main/CLAUDE.md`:

```markdown
## Proposal Generator

Generate AI-powered proposals:

**Generate proposal:**
```bash
/workspace/project/container/tools/proposal-generator.sh generate "Job Title" "Job description here"
```

**Analyze job fit:**
```bash
/workspace/project/container/tools/proposal-generator.sh analyze "Job Title" "Job description"
```

**Generate variations:**
```bash
/workspace/project/container/tools/proposal-generator.sh variations "Job Title" "Description"
```

Use when user asks you to write a proposal or analyze a job opportunity.
```

### 8. Rebuild

```bash
cd /Users/tyler/dev/nanoclaw
npm run build
./container/build.sh
```

---

## Usage

### Quick Proposal Generation

```
@Andy I found a job on Upwork: "Need n8n expert to automate sales pipeline. Must integrate Salesforce, Slack, and Google Sheets. Budget $1500." Generate a proposal.
```

Andy will:
1. Analyze the job requirements
2. Match with your experience
3. Generate tailored proposal
4. Suggest pricing/timeline
5. Provide key points to emphasize

### Job Fit Analysis

```
@Andy Should I apply to this job? "Looking for Python developer to build web scraping tool. $500 budget, 1 week deadline."
```

Andy analyzes and tells you:
- Match score (1-10)
- Your strengths for this job
- Potential concerns
- Recommendation (apply or skip)

### Multiple Variations

```
@Andy Generate 3 different proposals for this job, ranging from short to detailed.
```

Pick the one that feels right!

---

## Example Workflow

### When Andy Finds a High-Scoring Lead:

**Andy sends you:**
> 🎯 Score 9/10 on Upwork:
> "n8n Automation Expert Needed - API Integration"
> Budget: $2,000
> Link: [url]

**You reply:**
```
@Andy Generate a proposal for this job
```

**Andy generates:**
> *GENERATED PROPOSAL*
>
> Hi [Client name],
>
> I saw you need help automating your workflow with n8n...
> [Full customized proposal]
>
> *Suggested Pricing:* $1,800-2,200
> *Timeline:* 2-3 weeks
> *Confidence:* high

**You:**
- Copy proposal
- Make minor tweaks if needed
- Paste into Upwork
- Submit in under 5 minutes!

---

## Cost Breakdown

**Claude API Pricing:**
- Claude 3.5 Sonnet: ~$3 per million input tokens, $15 per million output
- Typical proposal: ~2000 tokens = **$0.10-0.30 per proposal**
- 100 proposals = **$10-30 total**

**ROI:**
- Time saved: 30 minutes per proposal
- 100 proposals = **50 hours saved**
- Land 1 project at $2,000 = **6,600% ROI**

---

## Success Criteria

✅ Claude API key configured
✅ Profile created with your experience
✅ Can generate proposals
✅ Can analyze job fit
✅ Can create variations
✅ Proposals sound natural and professional

---

## Pro Tips

### Always Customize!

Andy generates 90% of the work. You add the final 10%:
- Client's name (if known)
- Specific detail from their posting
- Personal touch/question
- Your availability

### Learn from Success

When a proposal gets accepted:

```
@Andy Save this proposal as a template named "n8n-automation-standard" for future jobs like this
```

### A/B Test

Try different variations:
- Short vs long
- Technical vs friendly
- With/without pricing

Track which works best!

---

Tell the user:

> Proposal Generator is ready! 🎉
>
> This will save you **hours every week** on proposal writing. Andy will:
> - Analyze each job opportunity
> - Generate customized proposals
> - Suggest pricing/timeline
> - Give you 90% done proposals
>
> Just copy, customize, and send!
>
> **Cost:** ~$0.20 per proposal (incredibly cheap for the time savings!)
