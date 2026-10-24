import type { OperationsAppConfig } from '../../types.js';
import { countAdvisorLevels } from '../privacy.js';

export async function readSupabaseSecuritySummary(app: OperationsAppConfig) {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  const projectRef = app.supabase.projectRef;
  if (!token || !projectRef || app.supabase.status === 'not-used') return null;
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${encodeURIComponent(projectRef)}/advisors/security`,
    {
      headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' },
      signal: AbortSignal.timeout(12_000),
    },
  );
  if (!response.ok) throw new Error('Supabase advisor request failed.');
  return countAdvisorLevels(await response.json());
}
