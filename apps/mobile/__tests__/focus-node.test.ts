import { Platform } from 'react-native';
import { focusNode } from '../src/labelscan/focus';

// On web, focusNode must make containers focusable by script without touching elements that are already focusable.
const el = (attrs: Record<string, string>, native = false) => {
  const a = new Map(Object.entries(attrs));
  return { a, hasAttribute: (n: string) => a.has(n), setAttribute: (n: string, v: string) => void a.set(n, v), matches: () => native, focus: jest.fn() };
};

describe('focusNode on web', () => {
  const os = Platform.OS;
  beforeEach(() => void (Platform.OS = 'web'));
  afterEach(() => void (Platform.OS = os));

  it('gives a heading tabindex -1 and focuses it', () => {
    const h = el({});
    focusNode(h as never);
    expect(h.a.get('tabindex')).toBe('-1');
    expect(h.focus).toHaveBeenCalled();
  });

  it('keeps an existing tabindex', () => {
    const b = el({ tabindex: '0' });
    focusNode(b as never);
    expect(b.a.get('tabindex')).toBe('0');
    expect(b.focus).toHaveBeenCalled();
  });

  it('adds no tabindex to a natively focusable element', () => {
    const b = el({}, true);
    focusNode(b as never);
    expect(b.a.has('tabindex')).toBe(false);
    expect(b.focus).toHaveBeenCalled();
  });
});
