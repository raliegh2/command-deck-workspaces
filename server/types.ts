export type ProjectState = 'connected' | 'ready' | 'paused' | 'needs-setup';
export type WorkStatus = 'queued' | 'in-progress' | 'review-pending' | 'blocked' | 'complete';

export interface ProjectConfig {
  id: string;
  name: string;
  kind: 'security' | 'builder' | 'integration' | 'knowledge' | 'other';
  root: string | null;
  knowledgePath?: string | null;
  remoteUrl?: string | null;
  description: string;
  teamId: string;
  healthUrl?: string | null;
  allowedScripts: string[];
}

export interface ProjectView extends ProjectConfig {
  gitStatus?: import('./git-status.js').GitStatus | null;
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
  color: 'green' | 'blue' | 'neutral';
  roles: string[];
}

export interface WorkItem {
  id: string;
  prompt: string;
  title: string;
  projectId: string;
  projectName: string;
  teamId: string;
  teamName: string;
  status: WorkStatus;
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

export interface RuntimeState {
  work: WorkItem[];
  activity: Activity[];
  changesets: ChangeSet[];
}

export type ProductionGateStatus = 'pass' | 'action-needed' | 'not-run' | 'not-applicable';

export interface ProductionAppConfig {
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
}

export interface ProductionGate {
  id: 'live' | 'repository' | 'dependencies' | 'headers' | 'build' | 'source' | 'security-operations';
  label: string;
  status: ProductionGateStatus;
  detail: string;
}

export interface ProductionAudit {
  status: 'ready' | 'review' | 'action-needed';
  lastRun: string | null;
  gates: ProductionGate[];
  vulnerabilities: { critical: number; high: number; moderate: number; low: number; info: number; total: number };
  dependencyFindings: Array<{
    package: string;
    title: string;
    severity: 'critical' | 'high' | 'moderate' | 'low' | 'info';
    cwe: string[];
    url: string;
    fixAvailable: boolean;
  }>;
}

export interface ProductionAppView extends ProductionAppConfig {
  teamName: string;
  teamRoles: string[];
  repository: {
    exists: boolean;
    isGit: boolean;
    dirty: boolean;
    branch: string | null;
  };
  live: {
    online: boolean;
    statusCode: number | null;
    finalUrl: string;
    checkedAt: string;
    embedded: boolean;
  };
  audit: ProductionAudit;
}

export type AgentMode = 'automatic' | 'observe' | 'staging' | 'gate-only';
export type ConnectorStatus = 'connected' | 'needs-configuration' | 'not-used';
export type StagingStatus = 'ready' | 'partial' | 'not-configured';

export interface OperationsConfig {
  schemaVersion: '1.0';
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
  };
  alerting: {
    provider: 'discord';
    policy: 'urgent-only';
    severities: Array<'outage' | 'critical'>;
    status: 'needs-configuration' | 'configured';
  };
  agentRoles: Array<{
    id: string;
    name: string;
    responsibility: string;
    mode: AgentMode;
  }>;
  apps: OperationsAppConfig[];
}

export interface OperationsAppConfig {
  id: string;
  provider: {
    kind: 'render' | 'vercel' | 'github-pages' | 'cloudflare-workers';
    name: string;
    verified: boolean;
    serviceId?: string | null;
    ownerId?: string | null;
    projectId?: string | null;
    teamId?: string | null;
  };
  staging: {
    strategy: string;
    status: StagingStatus;
    url: string | null;
    productionDataAllowed: false;
    detail: string;
  };
  supabase: {
    status: 'verified' | 'not-used';
    projectRef: string | null;
    projectName: string | null;
    branchStatus: 'not-configured' | 'ready' | 'not-applicable';
    advisorStatus: 'ready' | 'action-needed' | 'unavailable' | 'not-applicable';
    securityWarnings: number;
    securityInfo: number;
    observedAt: string | null;
  };
}

export interface SafeOperationsSnapshot {
  schemaVersion: '1.0';
  lastRun: string | null;
  sites: Array<{
    id: string;
    live: 'online' | 'offline' | 'unknown';
    statusCode: number | null;
    providerErrors: number | null;
    providerErrorClasses: Record<string, number>;
    supabaseSecurity: { warnings: number; errors: number; info: number } | null;
    failureStreak: number;
    /** Consecutive failed attempts within this run (all attempts failed when it equals the attempt count). */
    failedAttempts?: number;
    checkedAt: string;
  }>;
}
