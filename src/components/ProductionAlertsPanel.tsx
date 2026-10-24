import { ExternalLink, LoaderCircle, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { isHostedDeployment } from '../hosted';
import type { ProductionAlerts } from '../../shared/production-alerts';

const labels = { incident: 'Production incident', passing: 'Checks passing', stale: 'Monitoring overdue', unknown: 'Status unavailable', 'check-failed': 'Monitor check failed' };
const time = (value: string) => new Date(value).toLocaleString();

export function ProductionAlertsPanel() {
  const [data, setData] = useState<ProductionAlerts | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);
  const mounted = useRef(true);
  const hosted = isHostedDeployment();
  const refresh = useCallback(async () => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    try {
      const result = await api.productionAlerts();
      if (mounted.current) { setData(result); setError(''); }
    } catch {
      if (mounted.current) setError('Production alert data could not be refreshed. Check the local GitHub login and try again.');
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    if (hosted) return;
    void refresh();
    const interval = window.setInterval(() => { void refresh(); }, 60_000);
    return () => { mounted.current = false; window.clearInterval(interval); };
  }, [refresh, hosted]);
  return <section className="wide-view panel production-alert-feed" aria-labelledby="production-alert-title">
    <header><div><h1 id="production-alert-title">Production alerts</h1><p>Example Care and Example Planner · outages, broken application assets, and readiness failures.</p></div>
      <button className="subtle-button" disabled={busy || hosted} onClick={() => void refresh()}>{busy ? <LoaderCircle size={16} className="spin" /> : <RefreshCw size={16} />}{busy ? 'Refreshing…' : 'Refresh alerts'}</button></header>
    <p className="production-alert-note">GitHub monitors continue when this deck is closed. This feed refreshes every minute while open. Scheduled production checks run every 15 minutes; delivery can be delayed.</p>
    {hosted ? <p role="status">Open the local Command Deck to read live production alerts.</p> : null}
    {error ? <p className="production-alert-warning" role="alert">{error}</p> : null}
    {!data && !error && !hosted ? <p role="status">Reading production monitors from GitHub…</p> : null}
    <div aria-live="polite">{data?.sites.map(site => <article className="production-alert-site" key={site.id}>
      <div className="production-alert-site-heading"><h2>{site.name}</h2><strong className={'production-alert-state ' + (error ? 'unknown' : site.status)}>{error ? 'Status unavailable' : labels[site.status]}</strong></div>
      <p>{site.connected ? site.monitoringEnabled ? 'Production monitor enabled' : 'Production monitor disabled' : 'GitHub connection unavailable; displayed evidence may be old.'}
        {site.lastCheck ? <> · Last completed check <time dateTime={site.lastCheck.at}>{time(site.lastCheck.at)}</time></> : ' · No completed check available'}</p>
      <div className="production-alert-links"><a href={site.workflowUrl} target="_blank" rel="noreferrer">Monitor history <ExternalLink size={13} /></a>{site.lastCheck ? <a href={site.lastCheck.url} target="_blank" rel="noreferrer">Check evidence <ExternalLink size={13} /></a> : null}<a href={site.liveUrl} target="_blank" rel="noreferrer">Open production <ExternalLink size={13} /></a></div>
      {site.incidents.length ? <ul className="production-incident-list">{site.incidents.slice(0, 5).map(incident => <li key={incident.number}><a href={incident.url} target="_blank" rel="noreferrer">Incident #{incident.number} <ExternalLink size={13} /></a><span>{incident.state === 'open' ? 'Open · ' + time(incident.openedAt) : 'Recovered · ' + time(incident.closedAt ?? incident.openedAt)}</span></li>)}</ul> : <p className="production-alert-note">{site.connected ? 'No tracked production incidents.' : 'Incident history unavailable.'}</p>}
    </article>)}</div>
    <footer>Production incidents only. CI and dependency findings stay in GitHub checks. Alerts link to evidence and never apply production fixes automatically.</footer>
  </section>;
}
