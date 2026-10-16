import { fireEvent, render, screen } from '@testing-library/react-native';
import cards from '../../../content/cards.json';
import { BUNDLED } from '../src/content/bundled';
import { loadContent } from '../src/content/loader';
import { putStored, type ContentDb } from '../src/content/store';
import { chosenCards, HIDDEN_CARDS, renderBody, whyCard } from '../src/why/cards';
import { WhyLink } from '../src/why/WhyLink';
import { openDb } from './sync-helpers';

type Obj = Record<string, any>;
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const edit = (mutate: (b: Obj) => void): Obj => { const b = clone(cards) as Obj; mutate(b); return b; };

async function launch(stored?: unknown): Promise<void> {
  const db: ContentDb = await openDb();
  if (stored !== undefined) await putStored(db, { name: 'cards', sha256: 'x', schema_version: BUNDLED['cards']!.schema_version, updated_at: '2099-01-01T00:00:00Z', body: JSON.stringify(stored) });
  await loadContent(db);
}

describe('Why cards through the content store', () => {
  it('uses the shipped copy, and holds back the weak-source cards (#212)', async () => {
    await launch();
    expect(chosenCards()).toBe(cards);
    expect(whyCard('targets')?.title).toBe('Why these calorie and macro targets?');
    expect(HIDDEN_CARDS).toEqual(['ramp', 'ladder', 'formfirst']);
    for (const id of HIDDEN_CARDS) { expect(cards.cards.some((c) => c.id === id)).toBe(true); expect(whyCard(id)).toBeNull(); }
    expect(whyCard('constructor')).toBeNull();
  });

  it('uses a valid newer copy at load', async () => {
    await launch(edit((b) => { b.cards[0].title = 'Edited title'; }));
    expect(whyCard('targets')?.title).toBe('Edited title');
  });

  const bad: [string, (b: Obj) => void][] = [
    ['a shipped card removed', (b) => b.cards.splice(0, 1)],
    ['evidence outside the list', (b) => { b.cards[0].evidence = 'Certain'; }],
    ['source blank', (b) => { b.cards[0].source = '  '; }],
    ['body of 5000+ characters', (b) => { b.cards[0].body = 'x'.repeat(5001); }],
    ['bad id', (b) => { b.cards[1].id = '__proto__'; }],
    ['duplicate title', (b) => { b.cards[1].title = b.cards[0].title; }],
    ['review_status unknown', (b) => { b.cards[0].review_status = 'maybe'; }],
  ];
  it.each(bad)('rejects the whole copy: %s', async (_n, mutate) => {
    await launch(edit(mutate));
    expect(chosenCards()).toBe(cards);
  });
});

describe('renderBody', () => {
  it('fills placeholders, keeps a section on or takes its else part', () => {
    const b = 'A {?x}has {x}{:}no x{/x}, {y}.';
    expect(renderBody(b, { x: 3, y: 'z' })).toBe('A has 3, z.');
    expect(renderBody(b, { y: 'z' })).toBe('A no x, z.');
    expect(renderBody('{?x}on{/x}k', {})).toBe('k');
  });
});

describe('WhyLink', () => {
  it('opens the card with evidence and source, and renders nothing for a held-back or unknown card', async () => {
    await launch();
    await render(<><WhyLink id="scale" /><WhyLink id="ramp" /><WhyLink id="nope" /></>);
    expect(screen.getAllByRole('button')).toHaveLength(1);
    await fireEvent.press(screen.getByLabelText(/^Why\? /));
    expect(screen.getByText(/^Evidence: /)).toBeTruthy();
    expect(screen.getByText(/^Source: /)).toBeTruthy();
  });
});
