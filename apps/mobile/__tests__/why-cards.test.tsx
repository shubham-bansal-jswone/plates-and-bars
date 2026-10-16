import { fireEvent, render, screen } from '@testing-library/react-native';
import cards from '../../../content/cards.json';
import { BUNDLED } from '../src/content/bundled';
import { loadContent } from '../src/content/loader';
import { putStored, type ContentDb } from '../src/content/store';
import { cardTitle } from '../src/ai/cards';
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
    ['empty cards', (b) => { b.cards = []; }],
    ['placeholder named __proto__', (b) => { b.cards[0].placeholders[0] = '__proto__'; }],
    ['id that is an Object.prototype member', (b) => { b.cards[1].id = 'constructor'; }],
    ['a placeholder in the body that is not listed', (b) => { b.cards[0].placeholders.pop(); }],
    ['a listed placeholder the body does not use', (b) => { b.cards[0].placeholders.push('extra'); }],
    ['section opened inside a section', (b) => { b.cards[0].body = '{?tdee}a {?tdee}b{/tdee}{/tdee}'; b.cards[0].placeholders = []; }],
    ['two else parts in a section', (b) => { b.cards[0].body = '{?tdee}a{:}b{:}c{/tdee}'; b.cards[0].placeholders = []; }],
    ['section not closed', (b) => { b.cards[0].body = '{?tdee}a'; b.cards[0].placeholders = []; }],
    ['section not listed', (b) => { b.cards[0].sections = []; }],
    ['malformed brace', (b) => { b.cards[0].body += ' {Oops}'; }],
    ['learn_order not an integer', (b) => { b.cards[1].learn_order = 1.5; }],
    ['duplicate learn_order', (b) => { b.cards[1].learn_order = b.cards.find((c: Obj) => c.learn_order === 1).learn_order; }],
    ['learn_insert_at not an integer', (b) => { b.cards[1].learn_insert_at = 'x'; }],
    ['review_status unknown', (b) => { b.cards[0].review_status = 'maybe'; }],
  ];
  it.each(bad)('rejects the whole copy: %s', async (_n, mutate) => {
    await launch(edit(mutate));
    expect(chosenCards()).toBe(cards);
    expect(cardTitle('targets')).toBe(cards.cards[0]!.title);
  });

  it('the Ask why title and the Why sheet agree on an accepted copy and on a rejected one', async () => {
    await launch(edit((b) => { b.cards[0].title = 'Edited title'; }));
    expect(cardTitle('targets')).toBe('Edited title');
    expect(cardTitle('ramp')).toBe('ramp');
    await launch(edit((b) => { b.cards[0].evidence = 'Certain'; b.cards[0].title = 'Edited title'; }));
    expect(cardTitle('targets')).toBe(cards.cards[0]!.title);
  });
});

describe('renderBody', () => {
  it('fills placeholders, keeps a section on or takes its else part', () => {
    const b = 'A {?x}has {x}{:}no x{/x}, {y}.';
    expect(renderBody(b, { x: 3, y: 'z' })).toBe('A has 3, z.');
    expect(renderBody(b, { y: 'z' })).toBe('A no x, z.');
    expect(renderBody('{?x}on{/x}k', {})).toBe('k');
    // inherited names are not values
    expect(renderBody('{?constructor}x{/constructor}{constructor}', {})).toBe('');
    expect(renderBody('{x}', { x: undefined })).toBe('');
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
