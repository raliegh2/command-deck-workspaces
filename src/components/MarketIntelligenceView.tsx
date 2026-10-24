import { AlertTriangle, ArrowRight, Database, ExternalLink, FileCheck2, Globe2, LoaderCircle, RefreshCw, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../api';
import type { MarketIntelligenceData } from '../types';

function signed(value: number, digits = 2) {
  return `${value >= 0 ? '+' : ''}${value.toFixed(digits)}`;
}

function sourceStatus(status: MarketIntelligenceData['sources'][number]['status']) {
  return status === 'not-run' ? 'Not run' : status[0]!.toUpperCase() + status.slice(1);
}

export function MarketIntelligenceView({embedded=false}:{embedded?:boolean}={}) {
  const Container=embedded?'section':'main';const Heading=embedded?'h2':'h1';
  const [data, setData] = useState<MarketIntelligenceData | null>(null);
  const [busy, setBusy] = useState<'crawl' | 'backtest' | ''>('');
  const [error, setError] = useState('');

  async function load() {
    try { setData(await api.marketIntelligence()); setError(''); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Market intelligence could not be loaded.'); }
  }
  useEffect(() => { void load(); }, []);

  async function run(kind: 'crawl' | 'backtest') {
    if (busy) return;
    setBusy(kind); setError('');
    try {
      setData(kind === 'crawl' ? await api.crawlMarketIntelligence() : await api.backtestMarketIntelligence());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The research operation could not be completed.');
    } finally { setBusy(''); }
  }

  if (!data) return <Container className="wide-view market-loading"><LoaderCircle className="spin" /><p>{error || 'Loading market research controls…'}</p></Container>;
  const test = data.latestBacktest;
  const hosted = data.execution === 'hosted-read-only';
  return <Container className="wide-view market-view">
    <section className="market-hero">
      <div className="market-heading">
        <div><span className="eyebrow">Trading research · GBPUSD M5</span><Heading>Market intelligence crawler</Heading><p>Collect official monetary-policy release metadata, apply a causal post-release risk gate, and measure the result against the frozen V15.2 replay.</p></div>
        <div className="market-actions">
          <button className="subtle-button" onClick={() => run('crawl')} disabled={hosted || Boolean(busy)} title={hosted ? 'The crawler runs from the local Command Deck.' : undefined}>{busy === 'crawl' ? <LoaderCircle className="spin" size={16} /> : <RefreshCw size={16} />}{hosted ? 'Local crawler' : busy === 'crawl' ? 'Crawling…' : 'Refresh official sources'}</button>
          <button className="primary-button" onClick={() => run('backtest')} disabled={hosted || Boolean(busy) || !data.crawledAt} title={hosted ? 'Python replay runs from the local Command Deck.' : undefined}>{busy === 'backtest' ? <LoaderCircle className="spin" size={16} /> : <FileCheck2 size={16} />}{hosted ? 'Local backtest' : busy === 'backtest' ? 'Replaying…' : 'Run feature backtest'}</button>
        </div>
      </div>
      <div className="market-summary-rail">
        <div><strong>{data.eventCount}</strong><span>official releases</span><small>{data.crawledAt ? `Refreshed ${new Date(data.crawledAt).toLocaleString()}` : 'Crawler not run'}</small></div>
        <div><strong>{data.gatePolicy.hours}h</strong><span>post-release gate</span><small>Causal · no future events</small></div>
        <div><strong>{test?.blockedEntries ?? '—'}</strong><span>candidate entries gated</span><small>{test ? `${test.eventsInRange} events overlap data` : 'Backtest not run'}</small></div>
        <div><strong>{test ? signed(test.delta.netR, 3) : '—'}</strong><span>net R difference</span><small>{test ? test.evidenceGrade : 'Awaiting evidence'}</small></div>
      </div>
      <div className="market-boundary"><ShieldCheck size={19} /><div><strong>{hosted ? 'Hosted evidence mirror' : 'Research safety boundary'}</strong><span>{hosted ? 'Results mirror the verified local run. Crawl and Python replay remain local-only.' : 'Official allowlisted sources · metadata only · offline replay · no broker connection · no automatic promotion.'}</span></div><span className={'market-state ' + data.status}><i />{sourceStatus(data.status === 'idle' ? 'not-run' : data.status)}</span></div>
    </section>

    {error ? <button className="market-error" onClick={() => setError('')}><AlertTriangle size={16} />{error}<span>×</span></button> : null}

    <section className="market-grid">
      <article className="market-card market-sources">
        <header><div><Globe2 size={20} /><h2>Official sources</h2></div><span className="view-hint">Allowlist enforced</span></header>
        {data.sources.map((source) => <div className="market-source-row" key={source.id}><span className={'source-dot ' + source.status} /><div><strong>{source.name}</strong><p>{source.detail}</p><small>{source.host}</small></div><div><b>{source.documents}</b><span>documents</span></div></div>)}
      </article>
      <article className="market-card market-policy">
        <header><div><Database size={20} /><h2>Feature contract</h2></div><span className="view-hint">Frozen</span></header>
        <dl><div><dt>Gate</dt><dd>Block new entries only after release</dd></div><div><dt>Window</dt><dd>{data.gatePolicy.hours} hours from publication</dd></div><div><dt>Feed</dt><dd>{data.feedPath}</dd></div><div><dt>Promotion</dt><dd>Manual review required</dd></div></dl>
      </article>
    </section>

    <section className="market-card market-backtest">
      <header><div><FileCheck2 size={20} /><h2>Latest feature backtest</h2></div>{test ? <span className={'market-verdict ' + test.verdict.toLowerCase()}>{test.verdict.replaceAll('_', ' ')}</span> : <span className="view-hint">Not run</span>}</header>
      {test ? <>
        <div className="comparison-head"><span>Measure</span><span>Baseline</span><span>Crawler gate</span><span>Difference</span></div>
        <div className="comparison-row"><strong>Closed trades</strong><span>{test.baseline.closedTrades}</span><span>{test.feature.closedTrades}</span><span>{signed(test.delta.closedTrades, 0)}</span></div>
        <div className="comparison-row"><strong>Net R</strong><span>{test.baseline.netR.toFixed(3)}</span><span>{test.feature.netR.toFixed(3)}</span><span className={test.delta.netR >= 0 ? 'positive' : 'negative'}>{signed(test.delta.netR, 3)}</span></div>
        <div className="comparison-row"><strong>Net PnL</strong><span>{test.baseline.netPnl.toFixed(2)}</span><span>{test.feature.netPnl.toFixed(2)}</span><span className={test.delta.netPnl >= 0 ? 'positive' : 'negative'}>{signed(test.delta.netPnl)}</span></div>
        <div className="comparison-row"><strong>Max drawdown</strong><span>{test.baseline.maxDrawdownPct.toFixed(3)}%</span><span>{test.feature.maxDrawdownPct.toFixed(3)}%</span><span className={test.delta.maxDrawdownPct <= 0 ? 'positive' : 'negative'}>{signed(test.delta.maxDrawdownPct, 3)} pp</span></div>
        <div className="market-conclusion"><AlertTriangle size={18} /><div><strong>{test.note}</strong><p>{test.improvedPartitions} of 3 chronological partitions improved. Historical replay is not forward evidence and cannot justify live trading.</p>{test.reportPath.startsWith('/') ? <a href={test.reportPath} target="_blank" rel="noreferrer">Open evidence report <ExternalLink size={13} /></a> : <code>{test.reportPath}</code>}</div></div>
      </> : <div className="market-empty"><FileCheck2 size={33} /><div><strong>No paired replay yet</strong><p>Refresh the official feed, then run the frozen baseline and crawler-gate replay on the same data and costs.</p></div></div>}
    </section>

    <section className="market-card market-events">
      <header><div><Globe2 size={20} /><h2>Recent captured releases</h2></div><span className="view-hint">Metadata only</span></header>
      {data.recentEvents.length ? <><div className="market-events-head"><span>Published UTC</span><span>Source</span><span>Release</span><span>Pair</span></div>{data.recentEvents.map((event) => <a className="market-event-row" href={event.url} target="_blank" rel="noreferrer" key={event.id}><time>{new Date(event.publishedAt).toISOString().replace('.000Z', 'Z')}</time><span>{event.sourceName}</span><strong>{event.title}</strong><span>{event.currencies.join(' · ')}</span><ExternalLink size={14} /></a>)}</> : <div className="market-empty"><Globe2 size={33} /><div><strong>No releases captured</strong><p>Run the allowlisted crawl to build the local research feed.</p></div><ArrowRight size={18} /></div>}
    </section>
  </Container>;
}
