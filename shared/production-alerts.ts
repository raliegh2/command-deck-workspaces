export interface ProductionIncident {
  number: number;
  url: string;
  openedAt: string;
  closedAt: string | null;
  state: 'open' | 'closed';
}
export interface ProductionAlertSite {
  id: string;
  name: string;
  repository: string;
  liveUrl: string;
  workflowUrl: string;
  connected: boolean;
  monitoringEnabled: boolean | null;
  status: 'incident' | 'passing' | 'stale' | 'unknown' | 'check-failed';
  lastCheck: { at: string; conclusion: string; url: string } | null;
  incidents: ProductionIncident[];
}
export interface ProductionAlerts {
  fetchedAt: string;
  sites: ProductionAlertSite[];
}
