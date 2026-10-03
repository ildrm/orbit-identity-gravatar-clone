import { query } from './db.js';
export const analyticsKinds = [
  'profile_view',
  'avatar_request',
  'qr_scan',
  'block_interaction',
  'link_click',
  'application_request',
  'persona_view',
] as const;
export type AnalyticsKind = (typeof analyticsKinds)[number];
export async function recordAggregate(
  identityId: string,
  kind: AnalyticsKind,
  optOut = false,
): Promise<void> {
  if (optOut) return;
  await query(
    "INSERT INTO analytics_daily(identity_id,day,kind,count) SELECT id,current_date,$2,1 FROM identities WHERE id=$1 AND state='ACTIVE' AND analytics_enabled ON CONFLICT(identity_id,day,kind) DO UPDATE SET count=analytics_daily.count+1",
    [identityId, kind],
  );
}
