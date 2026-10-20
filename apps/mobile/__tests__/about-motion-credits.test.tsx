import { fireEvent, render, screen } from '@testing-library/react-native';
import { Linking } from 'react-native';
import { BUNDLED } from '../src/content/bundled';
import { loadContent } from '../src/content/loader';
import { putStored } from '../src/content/store';
import { AboutScreen } from '../src/about/AboutScreen';
import { MOTION_ENTRY_NAME, motionFixtureBundle } from './motion-helpers';
import { openDb } from './sync-helpers';

const OWN = MOTION_ENTRY_NAME;
const CC = 'Barbell Bench Press';
const SOURCE_URL = 'https://commons.wikimedia.org/wiki/File:Bench.webm';

/** A fixture bundle: the squat as own filming and a barbell bench press as a Commons clip (test data only; the shipped bundle stays empty). */
function bundle(): unknown {
  const b = motionFixtureBundle() as { motions: Record<string, Record<string, unknown>> };
  const base = b.motions[OWN]!;
  return {
    ...b,
    motions: {
      [OWN]: base,
      [CC]: { ...base, source: 'cc_licensed', source_id: 'commons/bench', source_url: SOURCE_URL, retrieved: '2026-03-04' },
    },
  };
}
async function launch(motion: unknown): Promise<void> {
  const db = await openDb();
  await putStored(db, { name: 'exercise-motion', sha256: 'x', schema_version: BUNDLED['exercise-motion']!.schema_version, updated_at: '2099-01-01T00:00:00Z', body: JSON.stringify(motion) });
  await loadContent(db);
}
const withCc = (): unknown => {
  const b = bundle() as { motions: Record<string, Record<string, unknown>> };
  b.motions[CC] = { ...b.motions[CC]!, licence: 'CC0-1.0', licence_url: 'https://creativecommons.org/publicdomain/zero/1.0/', author: 'Jo Example (CC0, via Wikimedia Commons)' };
  return b;
};

describe('About motion credits', () => {
  it('lists every shipped motion entry under its exercise name with author and licence link', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    await launch(withCc());
    await render(<AboutScreen onBack={() => {}} />);
    expect(screen.getByRole('header', { name: 'Motion' })).toBeTruthy();
    expect(screen.getByText(OWN)).toBeTruthy();
    expect(screen.getByText(CC)).toBeTruthy();
    expect(screen.getByText('Test Author')).toBeTruthy();
    expect(screen.getByText('Jo Example (CC0, via Wikimedia Commons)')).toBeTruthy();
    await fireEvent.press(screen.getByRole('link', { name: 'CC BY 4.0. Opens the licence' }));
    expect(open).toHaveBeenCalledWith('https://creativecommons.org/licenses/by/4.0/');
    await fireEvent.press(screen.getByRole('link', { name: 'CC0 1.0. Opens the licence' }));
    expect(open).toHaveBeenCalledWith('https://creativecommons.org/publicdomain/zero/1.0/');
  });

  it('a cc_licensed entry shows its source link and retrieved date; an own_filming entry says it was filmed for Plate & Bar', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    await launch(withCc());
    await render(<AboutScreen onBack={() => {}} />);
    expect(screen.getAllByRole('link', { name: /^Source for / })).toHaveLength(1);
    await fireEvent.press(screen.getByRole('link', { name: `Source for ${CC}. Opens the clip's page` }));
    expect(open).toHaveBeenCalledWith(SOURCE_URL);
    expect(screen.getByText('Retrieved 2026-03-04')).toBeTruthy();
    expect(screen.getAllByText('Filmed for Plate & Bar')).toHaveLength(1);
  });

  it('shows no Motion section when the bundle is empty', async () => {
    await launch({ ...(motionFixtureBundle() as object), motions: {} });
    await render(<AboutScreen onBack={() => {}} />);
    expect(screen.queryByText('Motion')).toBeNull();
    expect(screen.queryByText('Filmed for Plate & Bar')).toBeNull();
  });
});
