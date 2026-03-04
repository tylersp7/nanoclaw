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
  const configPath = path.join(
    os.homedir(),
    '.nanoclaw-proposals',
    'config.json',
  );
  if (!fs.existsSync(configPath)) {
    throw new Error(
      'Proposal generator config not found. Run /add-proposal-generator',
    );
  }
  return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
}

function loadProfile(): UserProfile {
  const profilePath = path.join(
    os.homedir(),
    '.nanoclaw-proposals',
    'profile.json',
  );
  if (!fs.existsSync(profilePath)) {
    throw new Error(
      'Profile not found. Create ~/.nanoclaw-proposals/profile.json',
    );
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
  },
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
${profile.experience
  .map(
    (exp) => `
- ${exp.name}: ${exp.description}
  Technologies: ${exp.technologies.join(', ')}
  Outcomes: ${exp.outcomes.join(', ')}
`,
  )
  .join('\n')}

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

  // Parse JSON response - handle potential markdown wrapping
  let text = content.text.trim();
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    text = jsonMatch[1].trim();
  }

  const result = JSON.parse(text);
  return result;
}

/**
 * Generate multiple proposal variations
 */
export async function generateProposalVariations(
  job: JobDetails,
  count: number = 3,
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
  feedback: string,
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

  let text = content.text.trim();
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    text = jsonMatch[1].trim();
  }

  return JSON.parse(text);
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
${proposal.keyPoints.map((point) => `• ${point}`).join('\n')}

---
Edit as needed before sending!`;
}

/**
 * Save successful proposal as template
 */
export function saveTemplate(
  name: string,
  proposal: string,
  jobType: string,
): void {
  const templatesDir = path.join(
    os.homedir(),
    '.nanoclaw-proposals',
    'templates',
  );
  fs.mkdirSync(templatesDir, { recursive: true });

  const template = {
    name,
    jobType,
    proposal,
    savedAt: new Date().toISOString(),
  };

  const templateFile = path.join(
    templatesDir,
    `${name.replace(/\s+/g, '-').toLowerCase()}.json`,
  );
  fs.writeFileSync(templateFile, JSON.stringify(template, null, 2));
}
