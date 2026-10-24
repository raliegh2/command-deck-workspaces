import { describe, expect, it } from 'vitest';
import { parseBoeRelease, parseBoeSitemap, parseFedIndex, parseFedRelease } from './market-intelligence.js';

describe('official market-intelligence parsers', () => {
  it('keeps only FOMC statement links and converts EDT to UTC', () => {
    const base = 'https://www.federalreserve.gov/newsevents/pressreleases/2025-press-fomc.htm';
    const links = parseFedIndex(`
      <a href="/newsevents/pressreleases/monetary20250730a.htm">Federal Reserve issues FOMC statement</a>
      <a href="/newsevents/pressreleases/monetary20250730b.htm">Implementation Note</a>`, base);
    expect(links).toHaveLength(1);
    const event = parseFedRelease('<p>For release at 2:00 p.m. EDT</p>', links[0]!.url, links[0]!.title);
    expect(event?.publishedAt).toBe('2025-07-30T18:00:00.000Z');
    expect(event?.currencies).toEqual(['USD']);
  });

  it('limits BOE sitemap rows to selected years and uses London publication time', () => {
    const base = 'https://www.bankofengland.co.uk/sitemap/minutes';
    const links = parseBoeSitemap(`
      <a href="/monetary-policy-summary-and-minutes/2025/december-2025">December 2025</a>
      <a href="/monetary-policy-summary-and-minutes/2024/december-2024">December 2024</a>`, base, new Set([2025]));
    expect(links).toHaveLength(1);
    const event = parseBoeRelease('<h1>Monetary Policy Summary</h1><p>Published on 18 December 2025</p>', links[0]!.url, links[0]!.title);
    expect(event?.publishedAt).toBe('2025-12-18T12:00:00.000Z');
    expect(event?.currencies).toEqual(['GBP']);
  });

  it('does not fabricate dates when an official page has no timestamp', () => {
    expect(parseFedRelease('<h1>Statement</h1>', 'https://www.federalreserve.gov/other.htm', 'Statement')).toBeNull();
    expect(parseBoeRelease('<h1>Minutes</h1>', 'https://www.bankofengland.co.uk/example', 'Minutes')).toBeNull();
  });
});
