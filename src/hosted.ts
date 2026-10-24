import type {DashboardData,MarketIntelligenceData,OperationsData} from './types';
export const hostedDashboard:DashboardData={deployment:{mode:'hosted-read-only',detail:'Public read-only shell; use local Command Deck for tools.'},projects:[],teams:[],work:[],activity:[],changesets:[],knowledge:{connected:false,root:'Local vault'}};
export const hostedProduction={apps:[]};
export const hostedOperations:OperationsData={"schemaVersion":"1.0","totals":{"agents":0,"systems":0,"automaticRoles":0},"privacy":{"mode":"metadata-only","rawLogRetentionMinutes":0,"customerDataAccess":"denied","stagingData":"synthetic-only","messageContent":"redacted-operational-summary"},"automation":{"provider":"vercel-cron","schedule":"0 0 * * *","blueprintPath":"vercel.json","deploymentStatus":"blueprint-ready","configured":false,"lastRun":null},"alerting":{"provider":"discord","policy":"urgent-only","configured":false},"connectors":{"render":{"status":"not-used","missing":[]},"vercel":{"status":"not-used","missing":[]},"supabase":{"status":"not-used","missing":[]},"cloudflare":{"status":"needs-configuration","missing":["provider-log-ingestion-connector"]},"discord":{"status":"needs-configuration","missing":["server-only"]}},"roles":[],"sites":[]};
export const hostedMarketIntelligence:MarketIntelligenceData={schemaVersion:'1.0',mode:'offline-research-only',execution:'hosted-read-only',status:'idle',crawledAt:null,eventCount:0,feedSha256:null,feedPath:'',gatePolicy:{kind:'post-release-risk-window',hours:24,causal:true,automaticPromotion:false},sources:[],recentEvents:[],latestBacktest:null};
export function isHostedDeployment() {
  return typeof window !== 'undefined' && !['127.0.0.1', 'localhost'].includes(window.location.hostname);
}

export async function hostedRequest<T>(url: string, options?: RequestInit): Promise<T> {
  const method = (options?.method ?? 'GET').toUpperCase();
  const path = new URL(url, window.location.origin).pathname;
  if (method !== 'GET') throw new Error('This control runs only on the local Command Deck. The Vercel site is a read-only operational mirror.');
  if (path === '/api/dashboard') return structuredClone(hostedDashboard) as T;
  if (path === '/api/production') return structuredClone(hostedProduction) as T;
  if (path === '/api/operations') return structuredClone(hostedOperations) as T;
  if (path === '/api/market-intelligence') return structuredClone(hostedMarketIntelligence) as T;
  if (path === '/api/knowledge/search') return { results: [] } as T;
  throw new Error('This workspace control is available only from the local Command Deck.');
}
