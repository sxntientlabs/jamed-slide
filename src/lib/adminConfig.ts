import { AGENT_DEFINITIONS, type AgentGroup, type AgentRiskTier, type AgentSourcePolicy } from "./agentCatalog";
import { DEFAULT_KOASIS_MODEL, KOASIS_MODELS, type KoasisModelId } from "./koasisModels";

export type AdminKnowledgeBaseItem = {
  id: string;
  title: string;
  content: string;
  sourceUrl?: string;
  enabled: boolean;
};

export type AdminAgentPersonalization = {
  tone: string;
  responseStyle: string;
  targetAudience: string;
  domainFocus: string;
  additionalInstructions: string;
};

export type AdminModelConfig = {
  id: string;
  label: string;
  tier: string;
  description: string;
  providerModelId: string;
  enabled: boolean;
};

export type AdminAgentConfig = {
  id: string;
  label: string;
  shortDescription: string;
  purpose: string;
  group: AgentGroup;
  riskTier: AgentRiskTier;
  riskLabel: string;
  sourcePolicy: AgentSourcePolicy;
  sourceLabel: string;
  outputContract: string[];
  handoffDescription: string;
  glyph: string;
  enabled: boolean;
  systemPrompt: string;
  knowledgeBase: AdminKnowledgeBaseItem[];
  personalization: AdminAgentPersonalization;
};

export type AdminConfig = {
  schemaVersion: 1;
  defaultModelId: string;
  defaultAgentId: string;
  models: AdminModelConfig[];
  agents: AdminAgentConfig[];
  updatedAt?: string;
};

export type PublicAdminModel = Omit<AdminModelConfig, "providerModelId">;
export type PublicAdminAgent = Omit<AdminAgentConfig, "systemPrompt" | "knowledgeBase" | "personalization">;
export type PublicAdminCatalog = {
  defaultModelId: string;
  defaultAgentId: string;
  models: PublicAdminModel[];
  agents: PublicAdminAgent[];
};

const ADMIN_ID_PATTERN = /^[a-z][a-z0-9_-]{1,63}$/;
const MODEL_ID_PATTERN = /^[a-z][a-z0-9_-]{1,47}$/;
const GLYPH_NAMES = new Set(["agent", "study", "clinical", "report", "concept", "plan", "case", "exam", "guideline", "workflow", "chat"]);
const GROUPS = new Set<AgentGroup>(["core", "clinical", "evidence", "documentation"]);
const RISK_TIERS = new Set<AgentRiskTier>(["workflow", "education", "clinical-support", "documentation"]);
const SOURCE_POLICIES = new Set<AgentSourcePolicy>(["workspace", "rubric-required", "source-required", "document-only"]);

function asRecord(value: unknown): Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function boundedString(value: unknown, fallback = "", max = 2_000): string {
  if (typeof value !== "string") return fallback;
  return value.trim().slice(0, max);
}

function boundedList(value: unknown, fallback: string[], maxItems = 12, maxLength = 180): string[] {
  if (!Array.isArray(value)) return fallback.slice(0, maxItems);
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim().slice(0, maxLength))
    .filter(Boolean)
    .slice(0, maxItems);
}

function defaultPersonalization(): AdminAgentPersonalization {
  return {
    tone: "Tenang, jelas, dan kolaboratif.",
    responseStyle: "Gunakan struktur yang mudah dipindai dan nyatakan ketidakpastian.",
    targetAudience: "Mahasiswa kedokteran dan tim klinis dalam batas supervisi.",
    domainFocus: "",
    additionalInstructions: "",
  };
}

function defaultAgentConfig(agent: typeof AGENT_DEFINITIONS[number]): AdminAgentConfig {
  return {
    id: agent.id,
    label: agent.label,
    shortDescription: agent.shortDescription,
    purpose: agent.purpose,
    group: agent.group,
    riskTier: agent.riskTier,
    riskLabel: agent.riskLabel,
    sourcePolicy: agent.sourcePolicy,
    sourceLabel: agent.sourceLabel,
    outputContract: [...agent.outputContract],
    handoffDescription: agent.handoffDescription,
    glyph: agent.id === "koasis" ? "agent" : agent.id === "study" ? "study" : agent.id === "prebrief" ? "study" : agent.id === "ward" ? "workflow" : agent.id === "case" ? "case" : agent.id === "procedure" ? "plan" : agent.id === "exam" || agent.id === "assessment" ? "exam" : agent.id === "guideline" ? "guideline" : agent.id === "evidence" ? "concept" : agent.id === "presentation" || agent.id === "lapjag" ? "report" : "chat",
    enabled: true,
    systemPrompt: agent.trustedInstructions,
    knowledgeBase: [],
    personalization: defaultPersonalization(),
  };
}

export function createDefaultAdminConfig(providerModelIds: Partial<Record<KoasisModelId, string>> = {}): AdminConfig {
  return {
    schemaVersion: 1,
    defaultModelId: DEFAULT_KOASIS_MODEL,
    defaultAgentId: "koasis",
    models: KOASIS_MODELS.map((model) => ({
      id: model.id,
      label: model.label,
      tier: model.tier,
      description: model.description,
      providerModelId: providerModelIds[model.id] || "",
      enabled: true,
    })),
    agents: AGENT_DEFINITIONS.map(defaultAgentConfig),
  };
}

function sanitizeKnowledgeBase(value: unknown, fallback: AdminKnowledgeBaseItem[]): AdminKnowledgeBaseItem[] {
  if (!Array.isArray(value)) return fallback.slice(0, 20);
  return value.map((item, index) => {
    const record = asRecord(item);
    return {
      id: boundedString(record.id, `kb-${index + 1}`, 80) || `kb-${index + 1}`,
      title: boundedString(record.title, "Untitled knowledge", 180) || "Untitled knowledge",
      content: boundedString(record.content, "", 8_000),
      ...(boundedString(record.sourceUrl, "", 500) ? { sourceUrl: boundedString(record.sourceUrl, "", 500) } : {}),
      enabled: record.enabled !== false,
    };
  }).filter((item) => item.content).slice(0, 20);
}

function sanitizeAgent(value: unknown, fallback: AdminAgentConfig, index: number): AdminAgentConfig | null {
  const record = asRecord(value);
  const id = boundedString(record.id, fallback.id, 64).toLowerCase();
  if (!ADMIN_ID_PATTERN.test(id)) return null;
  const personalizationRecord = asRecord(record.personalization);
  const personalization = {
    tone: boundedString(personalizationRecord.tone, fallback.personalization.tone, 600),
    responseStyle: boundedString(personalizationRecord.responseStyle, fallback.personalization.responseStyle, 1_000),
    targetAudience: boundedString(personalizationRecord.targetAudience, fallback.personalization.targetAudience, 600),
    domainFocus: boundedString(personalizationRecord.domainFocus, fallback.personalization.domainFocus, 600),
    additionalInstructions: boundedString(personalizationRecord.additionalInstructions, fallback.personalization.additionalInstructions, 2_000),
  };
  const group = GROUPS.has(record.group as AgentGroup) ? record.group as AgentGroup : fallback.group;
  const riskTier = RISK_TIERS.has(record.riskTier as AgentRiskTier) ? record.riskTier as AgentRiskTier : fallback.riskTier;
  const sourcePolicy = SOURCE_POLICIES.has(record.sourcePolicy as AgentSourcePolicy) ? record.sourcePolicy as AgentSourcePolicy : fallback.sourcePolicy;
  return {
    id,
    label: boundedString(record.label, fallback.label, 120) || fallback.label,
    shortDescription: boundedString(record.shortDescription, fallback.shortDescription, 220),
    purpose: boundedString(record.purpose, fallback.purpose, 1_200),
    group,
    riskTier,
    riskLabel: boundedString(record.riskLabel, fallback.riskLabel, 120),
    sourcePolicy,
    sourceLabel: boundedString(record.sourceLabel, fallback.sourceLabel, 160),
    outputContract: boundedList(record.outputContract, fallback.outputContract, 12, 160),
    handoffDescription: boundedString(record.handoffDescription, fallback.handoffDescription, 600),
    glyph: GLYPH_NAMES.has(record.glyph as string) ? String(record.glyph) : fallback.glyph,
    enabled: record.enabled !== false,
    systemPrompt: boundedString(record.systemPrompt, fallback.systemPrompt, 12_000),
    knowledgeBase: sanitizeKnowledgeBase(record.knowledgeBase, fallback.knowledgeBase),
    personalization,
  };
}

export function sanitizeAdminConfig(value: unknown, fallback = createDefaultAdminConfig()): AdminConfig {
  const record = asRecord(value);
  const fallbackAgentById = new Map(fallback.agents.map((agent) => [agent.id, agent]));
  const rawAgents = Array.isArray(record.agents) ? record.agents : fallback.agents;
  const agents: AdminAgentConfig[] = [];
  const seenAgentIds = new Set<string>();
  rawAgents.forEach((item, index) => {
    const itemRecord = asRecord(item);
    const candidateId = boundedString(itemRecord.id, "", 64).toLowerCase();
    const agentFallback = fallbackAgentById.get(candidateId) || fallback.agents[index] || fallback.agents[0];
    if (!agentFallback) return;
    const sanitized = sanitizeAgent(item, agentFallback, index);
    if (sanitized && !seenAgentIds.has(sanitized.id)) {
      seenAgentIds.add(sanitized.id);
      agents.push(sanitized);
    }
  });
  if (!agents.length) agents.push(...fallback.agents);
  if (!agents.some((agent) => agent.enabled)) agents[0].enabled = true;

  const fallbackModelById = new Map(fallback.models.map((model) => [model.id, model]));
  const rawModels = Array.isArray(record.models) ? record.models : fallback.models;
  const models: AdminModelConfig[] = [];
  const seenModelIds = new Set<string>();
  rawModels.forEach((item, index) => {
    const itemRecord = asRecord(item);
    const candidateId = boundedString(itemRecord.id, "", 48).toLowerCase();
    const modelFallback = fallbackModelById.get(candidateId) || fallback.models[index] || fallback.models[0];
    if (!modelFallback || !MODEL_ID_PATTERN.test(candidateId || modelFallback.id)) return;
    const id = candidateId || modelFallback.id;
    if (seenModelIds.has(id)) return;
    seenModelIds.add(id);
    models.push({
      id,
      label: boundedString(itemRecord.label, modelFallback.label, 120) || modelFallback.label,
      tier: boundedString(itemRecord.tier, modelFallback.tier, 80),
      description: boundedString(itemRecord.description, modelFallback.description, 400),
      providerModelId: boundedString(itemRecord.providerModelId, modelFallback.providerModelId, 180),
      enabled: itemRecord.enabled !== false,
    });
  });
  if (!models.length) models.push(...fallback.models);
  if (!models.some((model) => model.enabled)) models[0].enabled = true;

  const enabledModel = models.find((model) => model.enabled) || models[0];
  const enabledAgent = agents.find((agent) => agent.enabled) || agents[0];
  const requestedModel = boundedString(record.defaultModelId, fallback.defaultModelId, 48).toLowerCase();
  const requestedAgent = boundedString(record.defaultAgentId, fallback.defaultAgentId, 64).toLowerCase();
  return {
    schemaVersion: 1,
    defaultModelId: models.some((model) => model.id === requestedModel && model.enabled) ? requestedModel : enabledModel.id,
    defaultAgentId: agents.some((agent) => agent.id === requestedAgent && agent.enabled) ? requestedAgent : enabledAgent.id,
    models,
    agents,
    ...(boundedString(record.updatedAt, "", 80) ? { updatedAt: boundedString(record.updatedAt, "", 80) } : {}),
  };
}

export function toPublicAdminCatalog(config: AdminConfig): PublicAdminCatalog {
  return {
    defaultModelId: config.defaultModelId,
    defaultAgentId: config.defaultAgentId,
    models: config.models.filter((model) => model.enabled).map(({ providerModelId: _providerModelId, ...model }) => model),
    agents: config.agents.filter((agent) => agent.enabled).map(({ systemPrompt: _systemPrompt, knowledgeBase: _knowledgeBase, personalization: _personalization, ...agent }) => agent),
  };
}
