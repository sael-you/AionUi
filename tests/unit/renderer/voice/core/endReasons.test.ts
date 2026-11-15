import { describe, expect, it } from 'vitest';
import { callEndPolicy } from '@/renderer/voice/core/endReasons';

describe('callEndPolicy (PROTOCOL.md end reasons)', () => {
  it.each([
    ['sleep', { notice: null, disarm: true, redial: false }],
    ['disabled', { notice: 'disabled', disarm: true, redial: false }],
    ['auth_revoked', { notice: 'unauthorized', disarm: false, redial: false }],
    ['budget', { notice: 'budget', disarm: false, redial: false }],
    ['idle', { notice: 'callIdle', disarm: false, redial: false }],
    ['hard_cap', { notice: 'callHardCap', disarm: false, redial: false }],
    ['rotation', { notice: null, disarm: false, redial: true }],
  ])('%s', (reason, policy) => {
    expect(callEndPolicy(reason)).toEqual(policy);
  });

  it.each(['device_stale', 'config_timeout', 'attach_failed', 'control_lost', 'provider_ended', 'restart'])(
    '%s is a dropped call: stay armed and say so',
    (reason) => {
      expect(callEndPolicy(reason)).toEqual({ notice: 'callDropped', disarm: false, redial: false });
    }
  );

  it.each(['user', 'offline', 'network', 'resumed', 'device_frozen', '', 'something_new'])(
    '%s ends quietly and stays armed',
    (reason) => {
      expect(callEndPolicy(reason)).toEqual({ notice: null, disarm: false, redial: false });
    }
  );
});
