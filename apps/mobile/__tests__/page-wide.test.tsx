import { Dimensions, StyleSheet, Text } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import { Page } from '../src/components/ui';

const at = (width: number) => jest.spyOn(Dimensions, 'get').mockReturnValue({ width, height: 800, scale: 1, fontScale: 1 });
type Node = { props?: { role?: string; style?: object }; children?: unknown };
const find = (n: unknown): Node | undefined => {
  const node = n as Node;
  if (node?.props?.role === 'main') return node;
  for (const k of Array.isArray(node?.children) ? (node.children as unknown[]) : []) {
    const r = find(k);
    if (r) return r;
  }
};
const maxWidth = () => (StyleSheet.flatten(find(screen.toJSON())?.props?.style) as { maxWidth?: number }).maxWidth;

afterEach(() => jest.restoreAllMocks());

describe('Page wide', () => {
  it('keeps the 560px column below 900px, wide or not', async () => {
    at(899);
    await render(<Page wide><Text>x</Text></Page>);
    expect(maxWidth()).toBe(560);
  });

  it('grows to 1040px from 900px only when asked', async () => {
    at(1280);
    await render(<Page wide><Text>x</Text></Page>);
    expect(maxWidth()).toBe(1040);
  });

  it('stays 560px on a wide screen for a form', async () => {
    at(1280);
    await render(<Page><Text>x</Text></Page>);
    expect(maxWidth()).toBe(560);
  });
});
