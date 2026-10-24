type ProviderSummary = { count: number; classes: Record<string, number> };

function textFromEvent(event: unknown) {
  if (!event || typeof event !== 'object') return '';
  const value = event as Record<string, unknown>;
  const candidate = value.text ?? value.message ?? value.log ?? '';
  return typeof candidate === 'string' ? candidate.slice(0, 8_000) : '';
}

function levelFromEvent(event: unknown) {
  if (!event || typeof event !== 'object') return '';
  const value = event as Record<string, unknown>;
  return String(value.level ?? value.severity ?? '').toLowerCase();
}

export function classifyOperationalError(input: string) {
  const value = input.toLowerCase();
  if (/timeout|timed out|deadline/.test(value)) return 'timeout';
  if (/database|postgres|connection pool|sqlstate/.test(value)) return 'database';
  if (/auth|unauthori[sz]ed|forbidden|permission/.test(value)) return 'authorization';
  if (/dns|econn|network|socket|fetch failed/.test(value)) return 'network';
  if (/memory|heap|out of memory/.test(value)) return 'resource';
  if (/build|compile|bundle|module not found/.test(value)) return 'deployment';
  return 'application';
}

export function summarizeProviderEvents(events: unknown[]): ProviderSummary {
  const classes: Record<string, number> = {};
  let count = 0;
  for (const event of events.slice(0, 100)) {
    const level = levelFromEvent(event);
    const eventText = textFromEvent(event);
    if (!/error|fatal|critical/.test(level) && !/\b(?:error|exception|failed|5\d\d)\b/i.test(eventText)) continue;
    const category = classifyOperationalError(eventText);
    classes[category] = (classes[category] ?? 0) + 1;
    count += 1;
  }
  return { count, classes };
}

export function countAdvisorLevels(payload: unknown) {
  const root = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
  const source = root.result && typeof root.result === 'object' ? root.result as Record<string, unknown> : root;
  const lints = Array.isArray(source.lints) ? source.lints : [];
  const counts = { warnings: 0, errors: 0, info: 0 };
  for (const lint of lints) {
    if (!lint || typeof lint !== 'object') continue;
    const row = lint as Record<string, unknown>;
    const amount = Math.max(1, Number(row.count ?? 1));
    const level = String(row.level ?? '').toUpperCase();
    if (level === 'ERROR') counts.errors += amount;
    else if (level === 'WARN' || level === 'WARNING') counts.warnings += amount;
    else counts.info += amount;
  }
  return counts;
}
