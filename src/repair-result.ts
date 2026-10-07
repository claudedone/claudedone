import type { Outcome } from './domain';

export function summarizeOutcomes(outcomes: Outcome[]) {
  const completed = outcomes.filter(o => o.success).length;
  const failedIds = outcomes.filter(o => !o.success).map(o => o.id);
  const state = failedIds.length === 0 && completed > 0 ? 'success' : completed > 0 ? 'partial' : 'failed';
  return {
    completed, failedIds, state,
    title: state === 'success' ? '设置已准备，继续复检。' : state === 'partial' ? `${completed} 项完成，${failedIds.length} 项未完成` : '本次未完成任何修复',
  };
}
