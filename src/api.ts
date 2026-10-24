import type { DashboardData, MarketIntelligenceData, OperationsData, ProductionApp, WorkItem } from './types';
import { hostedRequest, isHostedDeployment } from './hosted';
import type { ProductionAlerts } from '../shared/production-alerts';

let session: Promise<string> | null = null;

/** The API issues a per-process token to same-origin UI requests only; it is kept in memory, never storage. */
function token() {
  session ??= fetch('/api/session')
    .then(async (response) => {
      const body = await response.json().catch(() => ({}));
      if (!response.ok || typeof body.token !== 'string') throw new Error(body.error ?? 'Command Deck API is unavailable.');
      return body.token as string;
    })
    .catch((error) => {
      session = null;
      throw error;
    });
  return session;
}

export async function request<T>(url: string, options?: RequestInit, retried = false): Promise<T> {
  if (isHostedDeployment()) return hostedRequest<T>(url, options);
  const response = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + await token(), ...options?.headers },
  });
  // The server issues a new token when it restarts (e.g. under `tsx watch`); fetch it once and retry.
  if (response.status === 401 && !retried) {
    session = null;
    return request<T>(url, options, true);
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? 'Command Deck could not complete that request.');
  return body as T;
}

export const api = {
  securityProgram:()=>request<import('./components/SecurityProgramPanel').SecurityProgramView>('/api/security/program'),
  runSecurityLabs:()=>request('/api/security/labs',{method:'POST',body:'{}'}),
  submitSecurityEvidence:(input:{projectId:string;practiceId:string;owner:string;summary:string;reference:string;observedAt:string})=>request('/api/security/evidence',{method:'POST',body:JSON.stringify(input)}),
  reviewSecurityEvidence:(id:string,decision:'approve'|'reject')=>request('/api/security/evidence/'+encodeURIComponent(id)+'/review',{method:'POST',body:JSON.stringify({decision})}),
  answerMemory: (input:{query:string;projectId:string;mode:'rag'|'cag'|'hybrid'})=>request<import('./components/AugmentedMemoryPanel').AugmentedAnswer>('/api/memory/answer',{method:'POST',body:JSON.stringify(input)}),
  memoryStatus: () => request<import('./components/NeuralMemoryPanel').MemoryStatus>('/api/memory/status'),
  indexMemory: () => request('/api/memory/index',{method:'POST'}),
  searchMemory: (q:string) => request<{mode:string;warning:string;results:import('./components/NeuralMemoryPanel').MemoryResult[]}>('/api/memory/search?q='+encodeURIComponent(q)),
  recordMemory: (input:{projectId:string;title:string;text:string;evidence:string[]})=>request('/api/memory/lessons',{method:'POST',body:JSON.stringify(input)}),
  reviewMemory: (id:string,decision:'approve'|'reject')=>request('/api/memory/lessons/'+encodeURIComponent(id)+'/review',{method:'POST',body:JSON.stringify({decision})}),
  productionAlerts: () => request<ProductionAlerts>('/api/production-alerts'),
  dashboard: (fresh = false) => request<DashboardData>('/api/dashboard' + (fresh ? '?fresh=1' : '')),
  dispatch: (prompt: string) => request<WorkItem>('/api/dispatch', { method: 'POST', body: JSON.stringify({ prompt }) }),
  production: (fresh = false) => request<{ apps: ProductionApp[] }>('/api/production' + (fresh ? '?fresh=1' : '')),
  operations: () => request<OperationsData>('/api/operations'),
  runOperations: () => request<OperationsData>('/api/operations/run', { method: 'POST' }),
  marketIntelligence: () => request<MarketIntelligenceData>('/api/market-intelligence'),
  crawlMarketIntelligence: () => request<MarketIntelligenceData>('/api/market-intelligence/crawl', { method: 'POST' }),
  backtestMarketIntelligence: () => request<MarketIntelligenceData>('/api/market-intelligence/backtest', { method: 'POST' }),
  auditProduction: (appId: string) => request<ProductionApp>('/api/production/' + encodeURIComponent(appId) + '/audit', { method: 'POST' }),
  requestProductionChange: (appId: string, prompt: string) => request<WorkItem>('/api/production/' + encodeURIComponent(appId) + '/request-change', { method: 'POST', body: JSON.stringify({ prompt }) }),
  registerProject: (payload: Record<string, unknown>) => request('/api/projects', { method: 'POST', body: JSON.stringify(payload) }),
  files: (projectId: string) => request<{ files: Array<{ path: string; type: 'file' | 'directory' }> }>('/api/projects/' + encodeURIComponent(projectId) + '/files'),
  file: (projectId: string, filePath: string) => request<{ path: string; content: string; hash: string; size: number }>('/api/projects/' + encodeURIComponent(projectId) + '/file?path=' + encodeURIComponent(filePath)),
  stageChange: (payload: { projectId: string; path: string; content: string; reason: string; baseHash: string }) => request('/api/changesets', { method: 'POST', body: JSON.stringify(payload) }),
  applyChange: (id: string) => request('/api/changesets/' + encodeURIComponent(id) + '/apply', { method: 'POST', body: JSON.stringify({ confirmation: 'APPLY' }) }),
  searchKnowledge: (query: string) => request<{ results: Array<{ title: string; path: string; excerpt: string }> }>('/api/knowledge/search?q=' + encodeURIComponent(query)),
};


export async function localResearchFile(url:string){
 if(!url.startsWith("/api/local/research/"))throw new Error("Invalid research download.");const response=await fetch(url,{headers:{Authorization:"Bearer "+await token()}});if(!response.ok)throw new Error("This export is unavailable. Reload the saved research run.");return response.blob();
}
