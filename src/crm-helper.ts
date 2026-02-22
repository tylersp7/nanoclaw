import fs from 'fs';
import path from 'path';

const CRM_DIR = '/workspace/group/crm';
const LEADS_FILE = path.join(CRM_DIR, 'leads.json');

export interface Lead {
  id: string;
  title: string;
  description: string;
  source: string; // upwork, freelancer, reddit, hn, linkedin, github, n8n, referral
  url?: string;
  budget?: string;
  score: number;
  status: 'new' | 'contacted' | 'responded' | 'interview' | 'proposal_sent' | 'won' | 'lost' | 'skipped';
  notes: string[];
  followUpDate?: string;
  proposalDraft?: string;
  clientName?: string;
  clientEmail?: string;
  createdAt: string;
  updatedAt: string;
  wonAmount?: number;
  hubspotContactId?: string;
  hubspotDealId?: string;
}

interface CRMData {
  leads: Lead[];
  stats: {
    totalWon: number;
    totalRevenue: number;
    lastUpdated: string;
  };
}

function ensureDir(): void {
  fs.mkdirSync(CRM_DIR, { recursive: true });
}

function loadData(): CRMData {
  ensureDir();
  if (!fs.existsSync(LEADS_FILE)) {
    return { leads: [], stats: { totalWon: 0, totalRevenue: 0, lastUpdated: new Date().toISOString() } };
  }
  return JSON.parse(fs.readFileSync(LEADS_FILE, 'utf-8'));
}

function saveData(data: CRMData): void {
  ensureDir();
  data.stats.lastUpdated = new Date().toISOString();
  fs.writeFileSync(LEADS_FILE, JSON.stringify(data, null, 2));
}

function generateId(): string {
  return `lead-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
}

/**
 * Add a new lead
 */
export function addLead(
  title: string,
  source: string,
  options?: {
    description?: string;
    url?: string;
    budget?: string;
    score?: number;
    clientName?: string;
  }
): Lead {
  const data = loadData();

  // Check for duplicate (same URL or very similar title from same source)
  if (options?.url) {
    const existing = data.leads.find(l => l.url === options.url);
    if (existing) {
      return existing; // Return existing instead of creating duplicate
    }
  }

  const lead: Lead = {
    id: generateId(),
    title,
    description: options?.description || '',
    source,
    url: options?.url,
    budget: options?.budget,
    score: options?.score || 5,
    status: 'new',
    notes: [],
    clientName: options?.clientName,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  data.leads.push(lead);
  saveData(data);

  // Auto-sync to HubSpot if configured
  syncLeadToHubSpot(lead).catch(() => {});

  return lead;
}

/**
 * Update a lead's status
 */
export function updateLead(
  id: string,
  updates: Partial<Pick<Lead, 'status' | 'notes' | 'followUpDate' | 'proposalDraft' | 'clientName' | 'clientEmail' | 'score' | 'wonAmount' | 'hubspotContactId' | 'hubspotDealId'>>
): Lead | null {
  const data = loadData();
  const lead = data.leads.find(l => l.id === id);
  if (!lead) return null;

  const statusChanged = updates.status && updates.status !== lead.status;

  if (updates.status) lead.status = updates.status;
  if (updates.followUpDate) lead.followUpDate = updates.followUpDate;
  if (updates.proposalDraft) lead.proposalDraft = updates.proposalDraft;
  if (updates.clientName) lead.clientName = updates.clientName;
  if (updates.clientEmail) lead.clientEmail = updates.clientEmail;
  if (updates.score !== undefined) lead.score = updates.score;
  if (updates.wonAmount !== undefined) lead.wonAmount = updates.wonAmount;
  if (updates.hubspotContactId) lead.hubspotContactId = updates.hubspotContactId;
  if (updates.hubspotDealId) lead.hubspotDealId = updates.hubspotDealId;
  if (updates.notes) {
    lead.notes.push(...updates.notes);
  }

  lead.updatedAt = new Date().toISOString();

  // Update stats if won
  if (updates.status === 'won') {
    data.stats.totalWon++;
    if (updates.wonAmount) {
      data.stats.totalRevenue += updates.wonAmount;
    }
  }

  saveData(data);

  // Auto-update HubSpot deal stage if status changed and HubSpot IDs exist
  if (statusChanged && lead.hubspotDealId) {
    updateHubSpotDealStage(lead.hubspotDealId, lead.status).catch(() => {});
  }

  return lead;
}

/**
 * Add a note to a lead
 */
export function addNote(id: string, note: string): Lead | null {
  const data = loadData();
  const lead = data.leads.find(l => l.id === id);
  if (!lead) return null;

  lead.notes.push(`[${new Date().toISOString().split('T')[0]}] ${note}`);
  lead.updatedAt = new Date().toISOString();
  saveData(data);
  return lead;
}

/**
 * List leads with optional filters
 */
export function listLeads(filters?: {
  status?: string;
  source?: string;
  minScore?: number;
  limit?: number;
}): Lead[] {
  const data = loadData();
  let leads = data.leads;

  if (filters?.status) {
    leads = leads.filter(l => l.status === filters.status);
  }
  if (filters?.source) {
    leads = leads.filter(l => l.source === filters.source);
  }
  if (filters?.minScore) {
    leads = leads.filter(l => l.score >= filters.minScore!);
  }

  // Sort by score desc, then by creation date desc
  leads.sort((a, b) => b.score - a.score || new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  if (filters?.limit) {
    leads = leads.slice(0, filters.limit);
  }

  return leads;
}

/**
 * Get leads needing follow-up today
 */
export function getFollowUps(): Lead[] {
  const data = loadData();
  const today = new Date().toISOString().split('T')[0];

  return data.leads.filter(l =>
    l.followUpDate && l.followUpDate <= today &&
    !['won', 'lost', 'skipped'].includes(l.status)
  );
}

/**
 * Get pipeline stats
 */
export function getPipelineStats(): {
  total: number;
  byStatus: Record<string, number>;
  bySource: Record<string, number>;
  avgScore: number;
  totalWon: number;
  totalRevenue: number;
  conversionRate: string;
  recentLeads: number;
  pendingFollowUps: number;
} {
  const data = loadData();
  const leads = data.leads;

  const byStatus: Record<string, number> = {};
  const bySource: Record<string, number> = {};
  let totalScore = 0;

  for (const lead of leads) {
    byStatus[lead.status] = (byStatus[lead.status] || 0) + 1;
    bySource[lead.source] = (bySource[lead.source] || 0) + 1;
    totalScore += lead.score;
  }

  const contacted = (byStatus['contacted'] || 0) + (byStatus['responded'] || 0) +
    (byStatus['interview'] || 0) + (byStatus['proposal_sent'] || 0) +
    (byStatus['won'] || 0) + (byStatus['lost'] || 0);
  const won = byStatus['won'] || 0;
  const conversionRate = contacted > 0 ? `${Math.round((won / contacted) * 100)}%` : 'N/A';

  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const recentLeads = leads.filter(l => l.createdAt > weekAgo).length;

  const today = new Date().toISOString().split('T')[0];
  const pendingFollowUps = leads.filter(l =>
    l.followUpDate && l.followUpDate <= today &&
    !['won', 'lost', 'skipped'].includes(l.status)
  ).length;

  return {
    total: leads.length,
    byStatus,
    bySource,
    avgScore: leads.length > 0 ? Math.round((totalScore / leads.length) * 10) / 10 : 0,
    totalWon: data.stats.totalWon,
    totalRevenue: data.stats.totalRevenue,
    conversionRate,
    recentLeads,
    pendingFollowUps,
  };
}

/**
 * Search leads by keyword
 */
export function searchLeads(query: string): Lead[] {
  const data = loadData();
  const q = query.toLowerCase();

  return data.leads.filter(l =>
    l.title.toLowerCase().includes(q) ||
    l.description.toLowerCase().includes(q) ||
    l.notes.some(n => n.toLowerCase().includes(q)) ||
    (l.clientName && l.clientName.toLowerCase().includes(q))
  );
}

/**
 * Format leads for WhatsApp
 */
export function formatLeadsForWhatsApp(leads: Lead[]): string {
  if (leads.length === 0) return 'No leads found.';

  return leads.slice(0, 15).map((lead, i) => {
    const statusEmoji: Record<string, string> = {
      new: '🆕', contacted: '📧', responded: '💬', interview: '🎤',
      proposal_sent: '📝', won: '✅', lost: '❌', skipped: '⏭️',
    };
    const emoji = statusEmoji[lead.status] || '❓';
    const budget = lead.budget ? ` • 💰 ${lead.budget}` : '';
    const followUp = lead.followUpDate ? ` • 📅 ${lead.followUpDate}` : '';

    return `${i + 1}. ${emoji} *${lead.title}* [${lead.score}/10]
${lead.source}${budget}${followUp}
Status: ${lead.status} • ID: ${lead.id}
${lead.url ? `🔗 ${lead.url}` : ''}`;
  }).join('\n\n');
}

/**
 * Format pipeline stats for WhatsApp
 */
export function formatStatsForWhatsApp(stats: ReturnType<typeof getPipelineStats>): string {
  const statusLines = Object.entries(stats.byStatus)
    .map(([status, count]) => `• ${status}: ${count}`)
    .join('\n');

  const sourceLines = Object.entries(stats.bySource)
    .sort((a, b) => b[1] - a[1])
    .map(([source, count]) => `• ${source}: ${count}`)
    .join('\n');

  return `*Lead Pipeline*

Total Leads: ${stats.total}
New This Week: ${stats.recentLeads}
Avg Score: ${stats.avgScore}/10
Pending Follow-ups: ${stats.pendingFollowUps}

*Deals:*
Won: ${stats.totalWon}
Revenue: $${stats.totalRevenue.toLocaleString()}
Conversion: ${stats.conversionRate}

*By Status:*
${statusLines || 'None'}

*By Source:*
${sourceLines || 'None'}`;
}

// ---------------------------------------------------------------------------
// HubSpot auto-sync helpers (lazy-loaded to avoid circular deps)
// ---------------------------------------------------------------------------

async function syncLeadToHubSpot(lead: Lead): Promise<void> {
  try {
    const { isHubSpotConfigured, syncLead } = await import('./hubspot-sync.js');
    if (!isHubSpotConfigured()) return;
    const result = await syncLead(lead);
    if (result.success && result.contactId) {
      // Write HubSpot IDs back to local lead
      const data = loadData();
      const local = data.leads.find(l => l.id === lead.id);
      if (local) {
        local.hubspotContactId = result.contactId;
        local.hubspotDealId = result.dealId;
        saveData(data);
      }
    }
  } catch {
    // HubSpot sync is best-effort — don't block CRM writes
  }
}

async function updateHubSpotDealStage(dealId: string, status: string): Promise<void> {
  try {
    const { isHubSpotConfigured, updateDealStage } = await import('./hubspot-sync.js');
    if (!isHubSpotConfigured()) return;
    await updateDealStage(dealId, status);
  } catch {
    // Best-effort
  }
}
