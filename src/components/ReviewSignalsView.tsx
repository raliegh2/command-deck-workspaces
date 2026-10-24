import { useEffect, useState } from 'react';
import { ExternalLink, FileCheck2, LoaderCircle, MessageSquareText, ShieldCheck } from 'lucide-react';

type Snapshot = {
  generated_at: string;
  status: string;
  metrics: { reviews: number; eligible_signals: number; predictive_accuracy: number | null; stock_prediction: number | null; spent_usd: number; free_credit_usage_usd?: number };
  tests: { run: number; passed: number };
  checks: Array<{ name: string; status: string; detail: string }>;
  assessment?: { headline: string; decision: string; mean_stars: number; low_star_share: number; financial_context: string; conclusion: string; upcoming_release: { date: string; quarter: string; source_url: string } };
};

export function ReviewSignalsView({embedded=false}:{embedded?:boolean}={}) {
  const Container=embedded?'section':'main';const Heading=embedded?'h2':'h1';
  const [data, setData] = useState<Snapshot | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    void fetch('/review-signals/status.json', { signal: controller.signal, cache: 'no-store' })
      .then(async response => {
        if (!response.ok) throw new Error('Research snapshot is unavailable.');
        const snapshot = await response.json() as Snapshot;
        if (!snapshot.metrics || !snapshot.tests || !Array.isArray(snapshot.checks)) throw new Error('Research snapshot is invalid.');
        if (!controller.signal.aborted) setData(snapshot);
      }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Research snapshot could not be loaded.'); });
    return () => controller.abort();
  }, []);

  if (!data) return <Container className="wide-view market-loading" role="status">{error ? <p>{error}</p> : <><LoaderCircle className="spin" /><p>Loading review research…</p></>}</Container>;
  return <Container className="wide-view market-view review-signals-view">
    <section className="market-hero">
      <div className="market-heading">
        <div><span className="eyebrow">Consumer products · earnings research</span><Heading>Product Review Signals</Heading><p>Track product complaints, compare quarterly sentiment with revenue, and test a separate stock-return hypothesis when price data are available.</p></div>
        <div className="market-actions"><a className="subtle-button" href="/review-signals/report.html" target="_blank" rel="noreferrer">Open research report <ExternalLink size={16} /></a></div>
      </div>
      <div className="market-summary-rail">
        <div><strong>{data.metrics.reviews}</strong><span>collected reviews</span><small>Amazon US · provisional marketplace</small></div>
        <div><strong>{data.metrics.eligible_signals}</strong><span>eligible signals</span><small>12 review quarters required for the pilot</small></div>
        <div><strong>{data.metrics.predictive_accuracy === null ? 'Unavailable' : `${(100 * data.metrics.predictive_accuracy).toFixed(1)}%`}</strong><span>prediction accuracy</span><small>Calculation tests do not validate predictions</small></div>
        <div><strong>${data.metrics.spent_usd.toFixed(2)}</strong><span>additional cash spent</span><small>Free credit used: ${(data.metrics.free_credit_usage_usd ?? 0).toFixed(2)}</small></div>
      </div>
      <div className="market-boundary"><ShieldCheck size={19} /><div><strong>{data.metrics.reviews > 0 ? "Pilot collected · history pending" : "Awaiting review data"}</strong><span>Local setup snapshot · {new Date(data.generated_at).toLocaleString()} · reload shows the latest synced snapshot.</span></div></div>
    </section>
    <section className="market-grid">
      <article className="market-card market-sources">
        <header><div><FileCheck2 size={20} /><h2>Setup and data checks</h2></div><span className="view-hint">{data.tests.passed}/{data.tests.run} logic tests passed</span></header>
        {data.checks.map(check => <div className="market-source-row" key={check.name}><span className={'source-dot ' + (check.status === 'passed' ? 'ready' : 'not-run')} /><div><strong>{check.name}</strong><p>{check.detail}</p></div><span>{check.status}</span></div>)}
      </article>
      <article className="market-card market-policy">
        <header><div><MessageSquareText size={20} /><h2>Experiment readiness</h2></div><span className="view-hint">No backtest yet</span></header>
        <dl><div><dt>First company</dt><dd>Logitech · LOGI</dd></div><div><dt>Review signal</dt><dd>Quarterly mean tone minus four-quarter baseline</dd></div><div><dt>Revenue target</dt><dd>Next-quarter year-over-year growth</dd></div><div><dt>Stock output</dt><dd>{data.metrics.stock_prediction === null ? 'Unavailable · price source and horizon pending' : String(data.metrics.stock_prediction)}</dd></div><div><dt>Next step</dt><dd>Use Web research for public review sources. Restricted pages require an approved source export; the historical pilot remains separate.</dd></div></dl>
      </article>
    </section>
    {data.assessment ? <section className="market-card market-backtest">
      <header><div><FileCheck2 size={20} /><h2>Review and earnings assessment</h2></div><span className="view-hint">{data.assessment.decision}</span></header>
      <div className="market-conclusion"><ShieldCheck size={18} /><div>
        <strong>{data.assessment.headline}</strong>
        <p>{data.metrics.reviews} unique reviews · average {(Math.round(data.assessment.mean_stars * 100) / 100).toFixed(2)}/5 · {(100 * data.assessment.low_star_share).toFixed(0)}% rated 1–2 stars. Star ratings are not a validated stock signal.</p>
        <p>{data.assessment.financial_context}</p>
        <p>{data.assessment.conclusion}</p>
        <a href={data.assessment.upcoming_release.source_url} target="_blank" rel="noreferrer">Next release: {data.assessment.upcoming_release.quarter} · {data.assessment.upcoming_release.date} <ExternalLink size={13} /></a>
      </div></div>
    </section> : null}
  </Container>;
}
