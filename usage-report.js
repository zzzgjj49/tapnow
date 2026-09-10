// Summaries use provider-reported usage, never an inferred monetary charge.
function reportedTokens(usage) {
  const valid = n => typeof n === 'number' && Number.isFinite(n) && n >= 0;
  if (valid(usage?.total_tokens)) return usage.total_tokens;
  const input = usage?.input_tokens ?? usage?.prompt_tokens;
  const output = usage?.output_tokens ?? usage?.completion_tokens;
  if (valid(input) || valid(output)) return (valid(input) ? input : 0) + (valid(output) ? output : 0);
  return null;
}
function usageReport({ users, usage, viewer, month }) {
  const admin = viewer.role === 'admin';
  const visibleUsers = admin ? users : users.filter(u => u.id === viewer.id);
  const records = usage.filter(r => String(r.createdAt).slice(0,7) === month && (admin || r.userId === viewer.id))
    .map(({ payload, error, ...r }) => ({ ...r, userName: users.find(u => u.id === r.userId)?.name || '历史任务', tokens: reportedTokens(r.usage) }))
    .sort((a,b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const empty = user => ({ userId:user.id, name:user.name, email:user.email, disabled:!!user.disabled, role:user.role,
    tasks:0, completed:0, active:0, failed:0, unresolved:0, tokens:0, unreported:0 });
  const summaries = new Map(visibleUsers.map(u => [u.id,empty(u)]));
  const totals = empty({});
  for (const r of records) {
    if (!summaries.has(r.userId)) summaries.set(r.userId, empty({id:r.userId,name:'历史任务（未关联成员）'}));
    for (const row of [summaries.get(r.userId),totals]) {
      row.tasks++;
      if (r.status === 'complete') row.completed++;
      else if (['queued','submitting','generating','archiving'].includes(r.status)) row.active++;
      else if (r.status === 'failed') row.failed++;
      else row.unresolved++;
      if (r.tokens === null) row.unreported++;
      else row.tokens += r.tokens;
    }
  }
  return { month, records, members:[...summaries.values()], totals, timezone:'UTC' };
}
module.exports = { reportedTokens, usageReport };
