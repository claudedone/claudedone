import { describe, expect, it } from 'vitest';
import { recommendedChecks, repairIds, defaultTimezoneTarget, type Check } from './domain';

describe('one-click repair scope', () => {
  it('excludes system-wide changes, manual checks, and already configured items', () => {
    const checks = [
      { id: 'timezone', status: 'warning', fixable: true },
      { id: 'offset', status: 'warning', fixable: true },
      { id: 'language', status: 'warning', fixable: true },
      { id: 'fonts', status: 'manual', fixable: false },
      { id: 'fonts', status: 'warning', fixable: true },
      { id: 'dns', status: 'configured', fixable: true },
      { id: 'webrtc', status: 'warning', fixable: false },
      { id: 'cli', status: 'warning', fixable: true },
    ] as Check[];
    expect(recommendedChecks(checks).map(c => c.id)).toEqual(['language', 'cli']);
  });
  it('maps offset adjustments to one timezone operation without duplicates', () => {
    expect(repairIds(['offset', 'timezone', 'language'])).toEqual(['timezone', 'language']);
  });
  it('defaults an offset repair to UTC rather than another UTC+8 timezone', () => {
    expect(defaultTimezoneTarget(['offset'])).toBe('utc');
    expect(defaultTimezoneTarget(['timezone'])).toBe('singapore');
    expect(defaultTimezoneTarget(['timezone', 'offset'])).toBe('utc');
  });
});
