export type ProjectState = 'connected' | 'ready' | 'paused' | 'needs-setup';

export interface Project {
  gitStatus?: {
    inspected: boolean;
    branch: string | null;
    upstream: string | null;
    ahead: number | null;
    behind: number | null;
    dirty: boolean;
    checkedAt: string;
  } | null;
  id: string;
  name: string;
  kind: 'security' | 'builder' | 'integration' | 'knowledge' | 'other';
  root: string | null;
  remoteUrl?: string | null;
  description: string;
  teamId: string;
  healthUrl?: string | null;
  allowedScripts: string[];
  state: ProjectState;
  exists: boolean;
  isGit: boolean;
  dirty: boolean;
  health: 'online' | 'offline' | 'not-configured';
  workspaceLabel: string;
  lastActivity: string;
}

export interface AgentTeam {
  id: string;
  name: string;
  description: string;
  roles: string[];
  color: 'green' | 'blue' | 'neutral';
}

export interface WorkItem {
  id: string;
  prompt: string;
  title: string;
  projectId: string;
  projectName: string;
  teamId: string;
  teamName: string;
  status: 'queued' | 'in-progress' | 'review-pending' | 'blocked' | 'complete';
  createdAt: string;
  summary: string;
  steps: string[];
}

export interface Activity {
  id: string;
  at: string;
  message: string;
  source: string;
  tone: 'green' | 'blue' | 'amber' | 'neutral';
}

export interface ChangeSet {
  id: string;
  projectId: string;
  path: string;
  reason: string;
  content: string;
  baseHash: string;
  status: 'pending' | 'applied' | 'rejected';
  createdAt: string;
  appliedAt?: string;
}

export interface DashboardData {
  deployment?: { mode: 'local-control' | 'hosted-read-only'; detail: string };
  projects: Project[];
  teams: AgentTeam[];
  work: WorkItem[];
  activity: Activity[];
  changesets: ChangeSet[];
  knowledge: { connected: boolean; root: string };
}

export type ProductionGateStatus = 'pass' | 'action-needed' | 'not-run' | 'not-applicable';

export interface ProductionGate {
  id: 'live' | 'repository' | 'dependencies' | 'headers' | 'build' | 'source' | 'security-operations';
  label: string;
  status: ProductionGateStatus;
  detail: string;
}

export interface ProductionApp {
  id: string;
  projectId: string;
  name: string;
  description: string;
  root: string;
  repositoryUrl: string;
  repositoryConnection: 'github-connected' | 'private-unverified';
  liveUrl: string;
  previewMode: 'iframe' | 'external-only';
  teamId: string;
  teamName: string;
  teamRoles: string[];
  repository: { exists: boolean; isGit: boolean; dirty: boolean; branch: string | null };
  live: { online: boolean; statusCode: number | null; finalUrl: string; checkedAt: string; embedded: boolean };
  audit: {
    status: 'ready' | 'review' | 'action-needed';
    lastRun: string | null;
    gates: ProductionGate[];
    vulnerabilities: { critical: number; high: number; moderate: number; low: number; info: number; total: number };
    dependencyFindings: Array<{ package: string; title: string; severity: 'critical' | 'high' | 'moderate' | 'low' | 'info'; cwe: string[]; url: string; fixAvailable: boolean }>;
  };
}

export type AgentMode = 'automatic' | 'observe' | 'staging' | 'gate-only';

export interface OperationsData {
  schemaVersion: '1.0';
  totals: { agents: number; systems: number; automaticRoles: number };
  privacy: {
    mode: 'metadata-only';
    rawLogRetentionMinutes: 0;
    customerDataAccess: 'denied';
    stagingData: 'synthetic-only';
    messageContent: 'redacted-operational-summary';
  };
  automation: {
    provider: 'vercel-cron';
    schedule: string;
    blueprintPath: string;
    deploymentStatus: 'blueprint-ready' | 'deployed';
    configured: boolean;
    lastRun: string | null;
  };
  alerting: {
    provider: 'discord';
    policy: 'urgent-only';
    configured: boolean;
  };
  connectors: {
    render: { status: 'connected' | 'needs-configuration' | 'not-used'; missing: string[] };
    vercel: { status: 'connected' | 'needs-configuration' | 'not-used'; missing: string[] };
    supabase: { status: 'connected' | 'needs-configuration' | 'not-used'; missing: string[] };
    discord: { status: 'connected' | 'needs-configuration' | 'not-used'; missing: string[] };
    cloudflare?: { status: 'connected' | 'needs-configuration' | 'not-used'; missing: string[] };
  };
  roles: Array<{ id: string; name: string; responsibility: string; mode: AgentMode }>;
  sites: OperationsSite[];
}

export interface OperationsSite {
  id: string;
  provider: { kind: 'render' | 'vercel' | 'github-pages' | 'cloudflare-workers'; name: string; verified: boolean; connectorConfigured: boolean };
  agents: { count: number; roles: OperationsData['roles'] };
  staging: {
    strategy: string;
    status: 'ready' | 'partial' | 'not-configured';
    url: string | null;
    productionDataAllowed: false;
    detail: string;
  };
  supabase: {
    status: 'verified' | 'not-used';
    projectName: string | null;
    branchStatus: 'not-configured' | 'ready' | 'not-applicable';
    advisorStatus: 'ready' | 'action-needed' | 'unavailable' | 'not-applicable';
    securityWarnings: number;
    securityInfo: number;
    workerConfigured: boolean;
  };
  monitor: {
    live: 'online' | 'offline' | 'unknown';
    statusCode: number | null;
    providerErrors: number | null;
    providerErrorClasses: Record<string, number>;
    failureStreak: number;
    checkedAt: string | null;
  };
}

export interface MarketIntelligenceEvent {
  id: string;
  sourceId: 'federal-reserve-fomc' | 'bank-of-england-mpc';
  sourceName: string;
  title: string;
  url: string;
  publishedAt: string;
  currencies: Array<'USD' | 'GBP'>;
  category: 'monetary-policy';
  impact: 'high';
}

export interface MarketIntelligenceData {
  schemaVersion: '1.0';
  mode: 'offline-research-only';
  execution?: 'local-enabled' | 'hosted-read-only';
  status: 'idle' | 'ready' | 'partial' | 'error';
  crawledAt: string | null;
  eventCount: number;
  feedSha256: string | null;
  feedPath: string;
  gatePolicy: { kind: 'post-release-risk-window'; hours: number; causal: true; automaticPromotion: false };
  sources: Array<{ id: MarketIntelligenceEvent['sourceId']; name: string; host: string; status: 'ready' | 'partial' | 'error' | 'not-run'; documents: number; detail: string }>;
  recentEvents: MarketIntelligenceEvent[];
  latestBacktest: null | {
    ranAt: string;
    verdict: 'INCONCLUSIVE_LOW_SAMPLE' | 'FEATURE_EFFECTIVE_IN_SAMPLE' | 'FEATURE_NOT_EFFECTIVE_IN_SAMPLE';
    evidenceGrade: 'insufficient' | 'research-only';
    baseline: { closedTrades: number; netR: number; netPnl: number; profitFactor: number | null; maxDrawdownPct: number };
    feature: { closedTrades: number; netR: number; netPnl: number; profitFactor: number | null; maxDrawdownPct: number };
    delta: { closedTrades: number; netR: number; netPnl: number; maxDrawdownPct: number };
    blockedEntries: number;
    eventsInRange: number;
    improvedPartitions: number;
    reportPath: string;
    note: string;
  };
}

export type NavigationId = 'operations' | 'tools' | 'engineering' | 'trading-intelligence' | 'research' | 'system' | 'assistant' | 'northstar' | 'local-tools' | 'overview' | 'production' | 'security' | 'projects' | 'agents' | 'work' | 'knowledge' | 'market-intelligence' | 'review-signals';
