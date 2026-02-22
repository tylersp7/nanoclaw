/**
 * HubSpot CRM Sync Module
 * Syncs leads from the local JSON CRM into HubSpot contacts, deals, notes, and tasks.
 */
import { Client } from '@hubspot/api-client';
import { FilterOperatorEnum } from '@hubspot/api-client/lib/codegen/crm/contacts/models/Filter.js';
import { AssociationSpecAssociationCategoryEnum } from '@hubspot/api-client/lib/codegen/crm/contacts/models/AssociationSpec.js';
import { PropertyCreateTypeEnum, PropertyCreateFieldTypeEnum } from '@hubspot/api-client/lib/codegen/crm/properties/models/PropertyCreate.js';

import type { Lead } from './crm-helper.js';
import { logger } from './logger.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SyncResult {
  success: boolean;
  contactId?: string;
  dealId?: string;
  error?: string;
}

export interface BatchResult {
  total: number;
  synced: number;
  errors: number;
  results: Array<{ leadId: string } & SyncResult>;
}

export interface HubSpotStats {
  totalContacts: number;
  totalDeals: number;
  dealsByStage: Record<string, number>;
  totalRevenue: number;
}

// ---------------------------------------------------------------------------
// Status → Deal Stage Mapping
// ---------------------------------------------------------------------------

const STATUS_TO_STAGE: Record<string, string> = {
  new: 'appointmentscheduled',           // New lead (not pending)
  contacted: 'appointmentscheduled',     // Initial contact made
  responded: 'qualifiedtobuy',           // They responded - qualified
  interview: 'presentationscheduled',    // Interview scheduled
  proposal_sent: 'decisionmakerboughtin', // Proposal sent
  won: 'closedwon',
  lost: 'closedlost',
  skipped: 'closedlost',
};

// ---------------------------------------------------------------------------
// Singleton client
// ---------------------------------------------------------------------------

let hubspotClient: Client | null = null;

export function isHubSpotConfigured(): boolean {
  return !!(process.env.HUBSPOT_TOKEN);
}

export function initHubSpot(): Client {
  if (hubspotClient) return hubspotClient;
  const token = process.env.HUBSPOT_TOKEN;
  if (!token) {
    throw new Error('HUBSPOT_TOKEN environment variable is not set');
  }
  hubspotClient = new Client({ accessToken: token });
  return hubspotClient;
}

// ---------------------------------------------------------------------------
// Rate limiting — 150ms between calls + exponential backoff on 429
// ---------------------------------------------------------------------------

let lastCallTime = 0;

async function rateLimited<T>(fn: () => Promise<T>, retries = 3): Promise<T> {
  const now = Date.now();
  const elapsed = now - lastCallTime;
  if (elapsed < 150) {
    await new Promise((r) => setTimeout(r, 150 - elapsed));
  }
  lastCallTime = Date.now();

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      const status = (err as { code?: number; statusCode?: number })?.code
        ?? (err as { code?: number; statusCode?: number })?.statusCode;
      if (status === 429 && attempt < retries) {
        const delay = Math.pow(2, attempt + 1) * 1000;
        logger.warn({ attempt, delay }, 'HubSpot rate limited, backing off');
        await new Promise((r) => setTimeout(r, delay));
        lastCallTime = Date.now();
        continue;
      }
      throw err;
    }
  }
  throw new Error('Unreachable');
}

// ---------------------------------------------------------------------------
// Token Validation
// ---------------------------------------------------------------------------

export async function validateToken(): Promise<{ valid: boolean; portalId?: string; error?: string }> {
  try {
    const client = initHubSpot();
    const resp = await client.crm.contacts.basicApi.getPage(1);
    // If we get here, token is valid.
    return { valid: true, portalId: resp.results.length > 0 ? 'connected' : 'connected (empty)' };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = (err as { code?: number; statusCode?: number })?.code
      ?? (err as { code?: number; statusCode?: number })?.statusCode;
    if (status === 401 || status === 403) {
      return { valid: false, error: 'Token invalid or expired. Go to HubSpot > Settings > Integrations > Private Apps and generate a new token.' };
    }
    return { valid: false, error: msg };
  }
}

// ---------------------------------------------------------------------------
// Custom Property Setup (idempotent)
// ---------------------------------------------------------------------------

const CONTACT_PROPERTIES = [
  { name: 'lead_source_platform', label: 'Lead Source Platform', type: 'enumeration', fieldType: 'select',
    options: ['reddit', 'hn', 'upwork', 'fiverr', 'freelancer', 'github', 'n8n', 'linkedin', 'referral'].map(v => ({ label: v, value: v })) },
  { name: 'lead_source_url', label: 'Lead Source URL', type: 'string', fieldType: 'text' },
  { name: 'lead_quality_score', label: 'Lead Quality Score', type: 'number', fieldType: 'number' },
  { name: 'tech_stack', label: 'Tech Stack', type: 'string', fieldType: 'text' },
  { name: 'budget_range', label: 'Budget Range', type: 'enumeration', fieldType: 'select',
    options: ['unknown', 'under_1k', '1k_5k', '5k_10k', 'over_10k'].map(v => ({ label: v, value: v })) },
  { name: 'lead_status_detail', label: 'Lead Status Detail', type: 'enumeration', fieldType: 'select',
    options: ['new', 'contacted', 'responded', 'interview', 'proposal_sent', 'won', 'lost', 'skipped'].map(v => ({ label: v, value: v })) },
  { name: 'first_seen_date', label: 'First Seen Date', type: 'date', fieldType: 'date' },
  { name: 'last_activity_date', label: 'Lead Last Activity', type: 'date', fieldType: 'date' },
  { name: 'monitor_id', label: 'Monitor ID', type: 'string', fieldType: 'text' },
  { name: 'notes_summary', label: 'Notes Summary', type: 'string', fieldType: 'textarea' },
];

const DEAL_PROPERTIES = [
  { name: 'project_type', label: 'Project Type', type: 'enumeration', fieldType: 'select',
    options: ['automation', 'integration', 'consulting', 'development', 'maintenance', 'other'].map(v => ({ label: v, value: v })) },
  { name: 'estimated_hours', label: 'Estimated Hours', type: 'number', fieldType: 'number' },
  { name: 'original_post_url', label: 'Original Post URL', type: 'string', fieldType: 'text' },
  { name: 'platform_fee_pct', label: 'Platform Fee %', type: 'number', fieldType: 'number' },
  { name: 'contract_type', label: 'Contract Type', type: 'enumeration', fieldType: 'select',
    options: ['fixed', 'hourly', 'retainer', 'milestone', 'other'].map(v => ({ label: v, value: v })) },
];

async function createPropertySafe(
  client: Client,
  objectType: string,
  prop: { name: string; label: string; type: string; fieldType: string; options?: Array<{ label: string; value: string }> },
): Promise<boolean> {
  try {
    await rateLimited(() =>
      client.crm.properties.coreApi.create(objectType, {
        name: prop.name,
        label: prop.label,
        type: prop.type as PropertyCreateTypeEnum,
        fieldType: prop.fieldType as PropertyCreateFieldTypeEnum,
        groupName: 'nanoclaw',
        ...(prop.options ? { options: prop.options.map((o, i) => ({ ...o, displayOrder: i, hidden: false })) } : {}),
      }),
    );
    return true;
  } catch (err: unknown) {
    const status = (err as { code?: number; statusCode?: number })?.code
      ?? (err as { code?: number; statusCode?: number })?.statusCode;
    if (status === 409) return false; // already exists
    throw err;
  }
}

async function ensurePropertyGroup(client: Client, objectType: string): Promise<void> {
  try {
    await rateLimited(() =>
      client.crm.properties.groupsApi.create(objectType, {
        name: 'nanoclaw',
        label: 'NanoClaw',
        displayOrder: -1,
      }),
    );
  } catch {
    // group already exists — fine
  }
}

export async function setupCustomProperties(): Promise<{ created: number; skipped: number }> {
  const client = initHubSpot();
  let created = 0;
  let skipped = 0;

  // Create property groups first
  await ensurePropertyGroup(client, 'contacts');
  await ensurePropertyGroup(client, 'deals');

  for (const prop of CONTACT_PROPERTIES) {
    const wasCreated = await createPropertySafe(client, 'contacts', prop);
    if (wasCreated) created++; else skipped++;
  }

  for (const prop of DEAL_PROPERTIES) {
    const wasCreated = await createPropertySafe(client, 'deals', prop);
    if (wasCreated) created++; else skipped++;
  }

  logger.info({ created, skipped }, 'HubSpot custom properties setup complete');
  return { created, skipped };
}

// ---------------------------------------------------------------------------
// Contact / Deal Lookup
// ---------------------------------------------------------------------------

export async function lookupContact(
  query: string,
): Promise<{ id: string; email?: string; monitorId?: string } | null> {
  const client = initHubSpot();

  // Try by email first
  if (query.includes('@')) {
    try {
      const resp = await rateLimited(() =>
        client.crm.contacts.searchApi.doSearch({
          filterGroups: [{
            filters: [{ propertyName: 'email', operator: FilterOperatorEnum.Eq, value: query }],
          }],
          properties: ['email', 'monitor_id', 'firstname', 'lastname'],
          limit: 1,
          after: '0',
          sorts: [],
        }),
      );
      if (resp.results.length > 0) {
        const c = resp.results[0];
        return { id: c.id, email: c.properties.email ?? undefined, monitorId: c.properties.monitor_id ?? undefined };
      }
    } catch (err) {
      logger.warn({ err, query }, 'HubSpot contact search by email failed');
    }
  }

  // Try by monitor_id
  try {
    const resp = await rateLimited(() =>
      client.crm.contacts.searchApi.doSearch({
        filterGroups: [{
          filters: [{ propertyName: 'monitor_id', operator: FilterOperatorEnum.Eq, value: query }],
        }],
        properties: ['email', 'monitor_id', 'firstname', 'lastname'],
        limit: 1,
        after: '0',
        sorts: [],
      }),
    );
    if (resp.results.length > 0) {
      const c = resp.results[0];
      return { id: c.id, email: c.properties.email ?? undefined, monitorId: c.properties.monitor_id ?? undefined };
    }
  } catch (err) {
    logger.warn({ err, query }, 'HubSpot contact search by monitor_id failed');
  }

  return null;
}

// ---------------------------------------------------------------------------
// Core Sync
// ---------------------------------------------------------------------------

function parseFirstName(name?: string): string {
  if (!name) return 'Unknown';
  return name.split(' ')[0];
}

function parseLastName(name?: string): string {
  if (!name) return '';
  const parts = name.split(' ');
  return parts.length > 1 ? parts.slice(1).join(' ') : '';
}

function buildMonitorId(lead: Lead): string {
  // If the lead has a URL, derive a monitor ID from source + url hash
  if (lead.url) {
    return `${lead.source}:${lead.url}`;
  }
  return `${lead.source}:${lead.id}`;
}

function parseBudgetRange(budget?: string): string {
  if (!budget) return 'unknown';
  const numMatch = budget.replace(/[^0-9.]/g, '');
  const val = parseFloat(numMatch);
  if (isNaN(val)) return 'unknown';
  if (val < 1000) return 'under_1k';
  if (val < 5000) return '1k_5k';
  if (val < 10000) return '5k_10k';
  return 'over_10k';
}

function parseBudgetAmount(budget?: string): number | undefined {
  if (!budget) return undefined;
  // Extract first number from budget (e.g., "$2000-5000" -> 2000, "$5k" -> 5000)
  const match = budget.match(/(\d+(?:\.\d+)?)/);
  if (!match) return undefined;
  const val = parseFloat(match[1]);
  // Handle k/K suffix (e.g., "5k" -> 5000)
  if (budget.toLowerCase().includes('k') && val < 1000) {
    return val * 1000;
  }
  return isNaN(val) ? undefined : val;
}

function toMidnightUTC(isoDate: string): string {
  // HubSpot date properties need midnight UTC timestamps
  const d = new Date(isoDate);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

export async function syncLead(lead: Lead): Promise<SyncResult> {
  const client = initHubSpot();
  const monitorId = buildMonitorId(lead);

  try {
    // 1. Upsert contact
    let contactId: string;
    const existing = await lookupContact(lead.clientEmail || monitorId);

    const contactProps: Record<string, string> = {
      firstname: parseFirstName(lead.clientName),
      lastname: parseLastName(lead.clientName),
      lead_source_platform: lead.source,
      lead_quality_score: String(lead.score),
      lead_status_detail: lead.status,
      monitor_id: monitorId,
      first_seen_date: toMidnightUTC(lead.createdAt),
      last_activity_date: toMidnightUTC(lead.updatedAt),
    };
    if (lead.clientEmail) contactProps.email = lead.clientEmail;
    if (lead.url) contactProps.lead_source_url = lead.url;
    if (lead.budget) contactProps.budget_range = parseBudgetRange(lead.budget);
    if (lead.notes.length > 0) {
      contactProps.notes_summary = lead.notes.slice(-3).join('\n').substring(0, 500);
    }

    if (existing) {
      contactId = existing.id;
      await rateLimited(() =>
        client.crm.contacts.basicApi.update(contactId, { properties: contactProps }),
      );
    } else {
      const created = await rateLimited(() =>
        client.crm.contacts.basicApi.create({ properties: contactProps, associations: [] }),
      );
      contactId = created.id;
    }

    // 2. Find or create deal
    let dealId: string;
    const dealSearch = await rateLimited(() =>
      client.crm.deals.searchApi.doSearch({
        filterGroups: [{
          filters: [{ propertyName: 'original_post_url', operator: FilterOperatorEnum.Eq, value: lead.url || monitorId }],
        }],
        properties: ['dealname', 'dealstage', 'original_post_url'],
        limit: 1,
        after: '0',
        sorts: [],
      }),
    );

    // Determine deal stage based on status
    let dealStage = STATUS_TO_STAGE[lead.status] || 'appointmentscheduled';

    const dealProps: Record<string, string> = {
      dealname: lead.title.substring(0, 200),
      dealstage: dealStage,
      original_post_url: lead.url || monitorId,
    };
    const amount = parseBudgetAmount(lead.budget);
    if (amount) dealProps.amount = String(amount);

    if (dealSearch.results.length > 0) {
      dealId = dealSearch.results[0].id;
      await rateLimited(() =>
        client.crm.deals.basicApi.update(dealId, { properties: dealProps }),
      );
    } else {
      const createdDeal = await rateLimited(() =>
        client.crm.deals.basicApi.create({ properties: dealProps, associations: [] }),
      );
      dealId = createdDeal.id;

      // Associate deal with contact
      await rateLimited(() =>
        client.crm.associations.v4.basicApi.create(
          'deals', dealId, 'contacts', contactId,
          [{ associationCategory: AssociationSpecAssociationCategoryEnum.HubspotDefined, associationTypeId: 3 }],
        ),
      );
    }

    // 3. Create engagement note with lead details
    const noteBody = [
      `Lead: ${lead.title}`,
      `Source: ${lead.source}`,
      `Score: ${lead.score}/10`,
      lead.budget ? `Budget: ${lead.budget}` : null,
      lead.url ? `URL: ${lead.url}` : null,
      lead.description ? `\n${lead.description.substring(0, 500)}` : null,
    ].filter(Boolean).join('\n');

    await rateLimited(() =>
      client.crm.objects.notes.basicApi.create({
        properties: {
          hs_note_body: noteBody,
          hs_timestamp: new Date().toISOString(),
        },
        associations: [
          {
            to: { id: contactId },
            types: [{ associationCategory: AssociationSpecAssociationCategoryEnum.HubspotDefined, associationTypeId: 202 }],
          },
          {
            to: { id: dealId },
            types: [{ associationCategory: AssociationSpecAssociationCategoryEnum.HubspotDefined, associationTypeId: 214 }],
          },
        ],
      }),
    );

    logger.info({ leadId: lead.id, contactId, dealId }, 'Lead synced to HubSpot');
    return { success: true, contactId, dealId };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err, leadId: lead.id }, 'Failed to sync lead to HubSpot');
    return { success: false, error: msg };
  }
}

export async function syncLeadBatch(leads: Lead[]): Promise<BatchResult> {
  const results: Array<{ leadId: string } & SyncResult> = [];
  let synced = 0;
  let errors = 0;

  for (const lead of leads) {
    const result = await syncLead(lead);
    results.push({ leadId: lead.id, ...result });
    if (result.success) synced++; else errors++;
  }

  return { total: leads.length, synced, errors, results };
}

// ---------------------------------------------------------------------------
// Deal Stage Update
// ---------------------------------------------------------------------------

export async function updateDealStage(dealId: string, status: string): Promise<void> {
  const client = initHubSpot();
  const stage = STATUS_TO_STAGE[status];
  if (!stage) {
    logger.warn({ status }, 'No HubSpot stage mapping for status');
    return;
  }

  await rateLimited(() =>
    client.crm.deals.basicApi.update(dealId, {
      properties: { dealstage: stage },
    }),
  );
  logger.info({ dealId, status, stage }, 'HubSpot deal stage updated');
}

// ---------------------------------------------------------------------------
// Follow-up Task Creation
// ---------------------------------------------------------------------------

export async function createFollowUpTask(
  lead: Lead,
  subject: string,
  dueDays: number = 3,
  priority: 'HIGH' | 'MEDIUM' | 'LOW' = 'MEDIUM',
): Promise<string | null> {
  const client = initHubSpot();
  const monitorId = buildMonitorId(lead);

  try {
    const contact = await lookupContact(lead.clientEmail || monitorId);
    if (!contact) {
      logger.warn({ leadId: lead.id }, 'Cannot create task — contact not found in HubSpot');
      return null;
    }

    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + dueDays);

    const task = await rateLimited(() =>
      client.crm.objects.tasks.basicApi.create({
        properties: {
          hs_task_subject: subject,
          hs_task_body: `Lead: ${lead.title}\nSource: ${lead.source}\nScore: ${lead.score}/10`,
          hs_task_status: 'NOT_STARTED',
          hs_task_priority: priority,
          hs_timestamp: dueDate.toISOString(),
        },
        associations: [
          {
            to: { id: contact.id },
            types: [{ associationCategory: AssociationSpecAssociationCategoryEnum.HubspotDefined, associationTypeId: 204 }],
          },
        ],
      }),
    );

    logger.info({ leadId: lead.id, taskId: task.id }, 'HubSpot follow-up task created');
    return task.id;
  } catch (err) {
    logger.error({ err, leadId: lead.id }, 'Failed to create HubSpot task');
    return null;
  }
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

export async function getHubSpotStats(): Promise<HubSpotStats> {
  const client = initHubSpot();

  try {
    // Get total contacts with our custom property
    const contactSearch = await rateLimited(() =>
      client.crm.contacts.searchApi.doSearch({
        filterGroups: [{
          filters: [{ propertyName: 'monitor_id', operator: FilterOperatorEnum.HasProperty }],
        }],
        properties: ['monitor_id'],
        limit: 1,
        after: '0',
        sorts: [],
      }),
    );

    // Get deals with stages
    const dealSearch = await rateLimited(() =>
      client.crm.deals.searchApi.doSearch({
        filterGroups: [{
          filters: [{ propertyName: 'original_post_url', operator: FilterOperatorEnum.HasProperty }],
        }],
        properties: ['dealstage', 'amount'],
        limit: 100,
        after: '0',
        sorts: [],
      }),
    );

    const dealsByStage: Record<string, number> = {};
    let totalRevenue = 0;

    for (const deal of dealSearch.results) {
      const stage = deal.properties.dealstage || 'unknown';
      dealsByStage[stage] = (dealsByStage[stage] || 0) + 1;
      if (deal.properties.dealstage === 'closedwon' && deal.properties.amount) {
        totalRevenue += parseFloat(deal.properties.amount) || 0;
      }
    }

    return {
      totalContacts: contactSearch.total,
      totalDeals: dealSearch.total,
      dealsByStage,
      totalRevenue,
    };
  } catch (err) {
    logger.error({ err }, 'Failed to get HubSpot stats');
    return { totalContacts: 0, totalDeals: 0, dealsByStage: {}, totalRevenue: 0 };
  }
}

// ---------------------------------------------------------------------------
// Pipeline Stages (for debugging)
// ---------------------------------------------------------------------------

export async function getPipelineStages(): Promise<Array<{ id: string; label: string }>> {
  const client = initHubSpot();

  try {
    const pipelines = await rateLimited(() =>
      client.crm.pipelines.pipelinesApi.getAll('deals'),
    );

    const stages: Array<{ id: string; label: string }> = [];
    for (const pipeline of pipelines.results) {
      for (const stage of pipeline.stages) {
        stages.push({ id: stage.id, label: `${pipeline.label} > ${stage.label}` });
      }
    }
    return stages;
  } catch (err) {
    logger.error({ err }, 'Failed to get pipeline stages');
    return [];
  }
}

// ---------------------------------------------------------------------------
// CLI entry point (called from hubspot.sh)
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);

  switch (command) {
    case 'validate': {
      const result = await validateToken();
      if (result.valid) {
        console.log(`Token valid. HubSpot account: ${result.portalId}`);
      } else {
        console.log(`ERROR: ${result.error}`);
        process.exit(1);
      }
      break;
    }

    case 'setup-properties': {
      const result = await setupCustomProperties();
      console.log(`Custom properties setup: ${result.created} created, ${result.skipped} already existed`);
      break;
    }

    case 'sync': {
      const { listLeads } = await import('./crm-helper.js');
      const limitArg = args.indexOf('--limit');
      const limit = limitArg >= 0 ? parseInt(args[limitArg + 1], 10) : 50;

      // Get leads that haven't been synced (no hubspotContactId)
      const allLeads = listLeads();
      const unsynced = allLeads.filter(l => !l.hubspotContactId).slice(0, limit);

      if (unsynced.length === 0) {
        console.log('All leads are already synced to HubSpot.');
        break;
      }

      console.log(`Syncing ${unsynced.length} leads to HubSpot...`);
      const result = await syncLeadBatch(unsynced);

      // Update local leads with HubSpot IDs
      const { updateLead } = await import('./crm-helper.js');
      for (const r of result.results) {
        if (r.success && r.contactId) {
          updateLead(r.leadId, {
            hubspotContactId: r.contactId,
            hubspotDealId: r.dealId,
          } as Partial<Lead>);
        }
      }

      console.log(`Sync complete: ${result.synced} synced, ${result.errors} errors`);
      break;
    }

    case 'status': {
      const stats = await getHubSpotStats();
      console.log('*HubSpot CRM Status*\n');
      console.log(`Contacts: ${stats.totalContacts}`);
      console.log(`Deals: ${stats.totalDeals}`);
      console.log(`Revenue (won): $${stats.totalRevenue.toLocaleString()}`);
      console.log('\n*Deals by Stage:*');
      for (const [stage, count] of Object.entries(stats.dealsByStage)) {
        console.log(`  ${stage}: ${count}`);
      }
      break;
    }

    case 'lookup': {
      const query = args[0];
      if (!query) {
        console.log('Usage: hubspot.sh lookup <email|monitor_id>');
        process.exit(1);
      }
      const contact = await lookupContact(query);
      if (contact) {
        console.log(`Found contact: ID=${contact.id}, email=${contact.email || 'N/A'}, monitorId=${contact.monitorId || 'N/A'}`);
      } else {
        console.log(`No contact found for: ${query}`);
      }
      break;
    }

    case 'push-lead': {
      const leadId = args[0];
      if (!leadId) {
        console.log('Usage: hubspot.sh push-lead <lead_id>');
        process.exit(1);
      }
      const { listLeads, updateLead } = await import('./crm-helper.js');
      const leads = listLeads();
      const lead = leads.find(l => l.id === leadId);
      if (!lead) {
        console.log(`Lead not found: ${leadId}`);
        process.exit(1);
      }
      const result = await syncLead(lead);
      if (result.success) {
        updateLead(leadId, {
          hubspotContactId: result.contactId,
          hubspotDealId: result.dealId,
        } as Partial<Lead>);
        console.log(`Synced: contactId=${result.contactId}, dealId=${result.dealId}`);
      } else {
        console.log(`Error: ${result.error}`);
        process.exit(1);
      }
      break;
    }

    case 'create-task': {
      const leadId = args[0];
      const subject = args[1];
      if (!leadId || !subject) {
        console.log('Usage: hubspot.sh create-task <lead_id> <subject> [--due DAYS] [--priority HIGH|MEDIUM|LOW]');
        process.exit(1);
      }
      const dueIdx = args.indexOf('--due');
      const dueDays = dueIdx >= 0 ? parseInt(args[dueIdx + 1], 10) : 3;
      const prioIdx = args.indexOf('--priority');
      const priority = prioIdx >= 0 ? args[prioIdx + 1] as 'HIGH' | 'MEDIUM' | 'LOW' : 'MEDIUM';

      const { listLeads } = await import('./crm-helper.js');
      const leads = listLeads();
      const lead = leads.find(l => l.id === leadId);
      if (!lead) {
        console.log(`Lead not found: ${leadId}`);
        process.exit(1);
      }
      const taskId = await createFollowUpTask(lead, subject, dueDays, priority);
      if (taskId) {
        console.log(`Task created: ${taskId}`);
      } else {
        console.log('Failed to create task (contact may not exist in HubSpot)');
        process.exit(1);
      }
      break;
    }

    case 'stages': {
      const stages = await getPipelineStages();
      if (stages.length === 0) {
        console.log('No pipeline stages found (or API error).');
      } else {
        console.log('*Pipeline Stages:*\n');
        for (const s of stages) {
          console.log(`  ${s.id} — ${s.label}`);
        }
      }
      break;
    }

    default:
      console.log('Usage: hubspot-sync.js <command> [args]');
      console.log('');
      console.log('Commands:');
      console.log('  validate                   Verify HubSpot token works');
      console.log('  setup-properties           Create custom HubSpot properties');
      console.log('  sync [--limit N]           Sync unsynced leads to HubSpot');
      console.log('  status                     Show HubSpot sync stats');
      console.log('  lookup <email|monitor_id>  Find contact in HubSpot');
      console.log('  push-lead <lead_id>        Force-sync a specific lead');
      console.log('  create-task <lead_id> <subject> [--due DAYS] [--priority HIGH|MEDIUM|LOW]');
      console.log('  stages                     List deal pipeline stages');
      process.exit(command ? 1 : 0);
  }
}

// Run CLI if executed directly
const isMain = process.argv[1]?.endsWith('hubspot-sync.js')
  || process.argv[1]?.endsWith('hubspot-sync.ts');
if (isMain) {
  main().catch((err) => {
    console.error('Error:', err.message || err);
    process.exit(1);
  });
}
