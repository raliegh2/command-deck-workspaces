const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function probe(url: string) {
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(10_000),
      headers: { 'user-agent': 'Command-Deck-Metadata-Monitor/1.0' },
    });
    await response.body?.cancel();
    return { ok: response.ok, statusCode: response.status as number | null };
  } catch {
    return { ok: false, statusCode: null };
  }
}

/**
 * Checks a URL, retrying failures within the same run. A site is reported offline only after
 * every attempt fails, so a single transient blip is not an outage, and a real outage is
 * confirmed in one run instead of needing three separate (daily) cron runs.
 */
export async function checkReachability(url: string, options: { attempts?: number; retryDelayMs?: number } = {}) {
  const attempts = Math.max(1, options.attempts ?? 3);
  const retryDelayMs = options.retryDelayMs ?? 4_000;
  const checkedAt = new Date().toISOString();
  let last = { ok: false, statusCode: null as number | null };
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    last = await probe(url);
    if (last.ok) return { live: 'online' as const, statusCode: last.statusCode, checkedAt, failedAttempts: attempt - 1 };
    if (attempt < attempts) await wait(retryDelayMs * attempt);
  }
  return { live: 'offline' as const, statusCode: last.statusCode, checkedAt, failedAttempts: attempts };
}
