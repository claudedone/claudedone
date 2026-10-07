import { expect, it } from 'vitest';
import { summarizeOutcomes } from './repair-result';

it('reports partial completion and retries only failures', () => {
  const summary = summarizeOutcomes([{ id: 'cli', success: true, message: '' }, { id: 'dns', success: false, message: '' }, { id: 'timezone', success: false, message: '' }]);
  expect(summary).toMatchObject({ state: 'partial', completed: 1, failedIds: ['dns', 'timezone'], title: '1 项完成，2 项未完成' });
});
it('does not present total failure or an empty result as saved', () => {
  expect(summarizeOutcomes([{ id: 'language', success: false, message: '' }]).state).toBe('failed');
  expect(summarizeOutcomes([]).state).toBe('failed');
});
it('presents success only when all requested operations succeeded', () => {
  expect(summarizeOutcomes([{ id: 'language', success: true, message: '' }])).toMatchObject({ state: 'success', completed: 1, failedIds: [] });
});
