import { labelScanEnabled } from '../src/labelscan/flag';

describe('label scan flag (#1067, ADR 010)', () => {
  it('is off unless set to exactly 1', () => {
    expect(labelScanEnabled(undefined)).toBe(false);
    expect(labelScanEnabled('')).toBe(false);
    expect(labelScanEnabled('true')).toBe(false);
    expect(labelScanEnabled('0')).toBe(false);
    expect(labelScanEnabled(' 1')).toBe(false);
    expect(labelScanEnabled('1')).toBe(true);
  });

  it('reads the build variable by default, and is off in the test environment', () => {
    const saved = process.env.EXPO_PUBLIC_LABEL_SCAN;
    try {
      delete process.env.EXPO_PUBLIC_LABEL_SCAN;
      expect(labelScanEnabled()).toBe(false);
      process.env.EXPO_PUBLIC_LABEL_SCAN = '1';
      expect(labelScanEnabled()).toBe(true);
    } finally {
      if (saved === undefined) delete process.env.EXPO_PUBLIC_LABEL_SCAN;
      else process.env.EXPO_PUBLIC_LABEL_SCAN = saved;
    }
  });
});
