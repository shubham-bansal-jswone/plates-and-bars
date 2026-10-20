import { AccessibilityInfo } from 'react-native';
import { parseNutritionLabel } from '@plate-and-bar/core';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { UserFoodFields } from '@plate-and-bar/core';
import { OcrError, recognize } from '../modules/plate-label-scanner';
import type { OcrErrorCode } from '../modules/plate-label-scanner';
import { LABEL_COPY as t, OCR_PROBLEM, WARNING_COPY } from '../src/labelscan/copy';
import { LabelScanFlow } from '../src/labelscan/LabelScanFlow';
import { releasePhoto, takeLabelPhoto } from '../src/labelscan/capture';
import { formOf } from '../src/labelscan/review';
import { FULL, LOOKS_OFF, MEDIUM_ALT, NOISE, ok, PARTIAL, UNKNOWN_BASIS } from './label-fixtures';

// The test renderer has no native tags: give every node one so the focus call can be seen.
jest.mock('react-native/Libraries/ReactNative/RendererProxy', () => ({ ...jest.requireActual('react-native/Libraries/ReactNative/RendererProxy'), findNodeHandle: () => 7 }));
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
jest.mock('../modules/plate-label-scanner', () => ({ recognize: jest.fn(), OcrError: jest.requireActual('../modules/plate-label-scanner/errors').OcrError }));
jest.mock('../src/labelscan/capture', () => ({ takeLabelPhoto: jest.fn(), releasePhoto: jest.fn(), CameraDenied: class CameraDenied extends Error {} }));

const recognizeMock = recognize as jest.MockedFunction<typeof recognize>;
const take = takeLabelPhoto as jest.MockedFunction<typeof takeLabelPhoto>;
const release = releasePhoto as jest.MockedFunction<typeof releasePhoto>;
const PHOTO = { uri: 'file:///cache/label.jpg', width: 1000, height: 1500 };

const handlers = () => ({ onAdd: jest.fn(), onSaveMine: jest.fn((f: UserFoodFields) => ({ id: 'u1', ...f })) as never, onCustom: jest.fn(), onClose: jest.fn(), onDone: jest.fn() });
type H = ReturnType<typeof handlers>;

beforeEach(() => {
  recognizeMock.mockReset();
  take.mockReset().mockResolvedValue(PHOTO);
  release.mockReset();
});

/** Photo, crop step, then "Read the label". */
async function toRead(h: H) {
  await render(<LabelScanFlow meal="Breakfast" {...h} />);
  await fireEvent.press(screen.getByRole('button', { name: t.take }));
  await fireEvent.press(await screen.findByRole('button', { name: t.read }));
}
async function toReview(lines = FULL) {
  const h = handlers();
  recognizeMock.mockResolvedValue(ok(lines));
  await toRead(h);
  await screen.findByRole('header', { name: t.reviewTitle });
  return h;
}
const field = (label: string) => screen.getByLabelText(label);
const addBtn = () => screen.getByRole('button', { name: 'Add to breakfast' });

describe('capture and crop', () => {
  it('takes one still photo and passes the crop box to recognize as fractions', async () => {
    recognizeMock.mockResolvedValue(ok(FULL));
    await toRead(handlers());
    expect(recognizeMock).toHaveBeenCalledWith(PHOTO.uri, undefined);
  });

  it('trimming an edge sends that frame', async () => {
    recognizeMock.mockResolvedValue(ok(FULL));
    await render(<LabelScanFlow meal="Breakfast" {...handlers()} />);
    await fireEvent.press(screen.getByRole('button', { name: t.take }));
    await fireEvent.press(await screen.findByRole('button', { name: t.trimMore('left') }));
    await fireEvent.press(screen.getByRole('button', { name: t.trimMore('left') }));
    await fireEvent.press(screen.getByRole('button', { name: t.trimMore('bottom') }));
    expect(screen.getByText(t.frame(90, 95))).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: t.read }));
    await waitFor(() => expect(recognizeMock).toHaveBeenCalled());
    expect(recognizeMock).toHaveBeenCalledWith(PHOTO.uri, { x: 0.1, y: 0, width: 0.9, height: 0.95 });
  });

  it('cancelling the picker stays on the first screen', async () => {
    take.mockResolvedValue(null);
    await render(<LabelScanFlow meal="Breakfast" {...handlers()} />);
    await fireEvent.press(screen.getByRole('button', { name: t.take }));
    expect(screen.getByRole('button', { name: t.take })).toBeTruthy();
    expect(recognizeMock).not.toHaveBeenCalled();
  });
});

describe('errors', () => {
  const codes = Object.keys(OCR_PROBLEM) as OcrErrorCode[];
  it.each(codes)('%s shows its own message with Try again and Type it in', async (code) => {
    const h = handlers();
    recognizeMock.mockRejectedValue(new OcrError(code));
    await toRead(h);
    expect(await screen.findByText(OCR_PROBLEM[code])).toBeTruthy();
    expect(screen.getByRole('button', { name: t.tryAgain })).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: t.typeIt }));
    expect(h.onCustom).toHaveBeenCalled();
  });

  it('the eight messages are different from each other', () => {
    expect(new Set(Object.values(OCR_PROBLEM)).size).toBe(8);
  });

  it('an error that is not an OcrError reads as "failed"', async () => {
    recognizeMock.mockRejectedValue(new Error('boom'));
    await toRead(handlers());
    expect(await screen.findByText(OCR_PROBLEM.failed)).toBeTruthy();
  });

  it('Try again goes back to taking a photo', async () => {
    recognizeMock.mockRejectedValue(new OcrError('failed'));
    await toRead(handlers());
    await fireEvent.press(await screen.findByRole('button', { name: t.tryAgain }));
    expect(screen.getByRole('button', { name: t.take })).toBeTruthy();
  });

  it('a draft that is not reviewable goes to "Couldn’t read this label", never to the review', async () => {
    const h = handlers();
    recognizeMock.mockResolvedValue(ok(NOISE));
    await toRead(h);
    expect(await screen.findByText(t.unreadable)).toBeTruthy();
    expect(screen.queryByRole('header', { name: t.reviewTitle })).toBeNull();
    expect(screen.getByRole('button', { name: t.tryAgain })).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: t.typeIt }));
    expect(h.onCustom).toHaveBeenCalled();
  });

  it('a denied camera says so and offers the photo picker path', async () => {
    const { CameraDenied } = jest.requireMock('../src/labelscan/capture');
    take.mockRejectedValue(new CameraDenied());
    await render(<LabelScanFlow meal="Breakfast" {...handlers()} />);
    await fireEvent.press(screen.getByRole('button', { name: t.take }));
    expect(await screen.findByText(t.cameraDenied)).toBeTruthy();
  });
});

describe('review', () => {
  it('shows progress while reading', async () => {
    let done!: (v: ReturnType<typeof ok>) => void;
    recognizeMock.mockReturnValue(new Promise((r) => (done = r)));
    await toRead(handlers());
    expect(screen.getByText(t.reading)).toBeTruthy();
    done(ok(FULL));
    await screen.findByRole('header', { name: t.reviewTitle });
  });

  it('moves focus to the review heading', async () => {
    const spy = jest.spyOn(AccessibilityInfo, 'setAccessibilityFocus').mockImplementation(() => undefined);
    await toReview();
    await waitFor(() => expect(spy).toHaveBeenCalledWith(7));
    spy.mockRestore();
  });

  it('prefills high fields, leaves low and missing empty, and marks medium and empty ones in words', async () => {
    await toReview(PARTIAL);
    expect(field(t.calories).props.value).toBe('400');
    expect(field(t.carbs).props.value).toBe('50');
    expect(field(t.protein).props.value).toBe('20'); // medium: filled and marked
    expect(field(t.fat).props.value).toBe(''); // missing
    expect(field(t.fibre).props.value).toBe(''); // low
    expect(field(t.addedSugar).props.value).toBe(''); // missing
    expect(screen.getAllByText(t.check)).toHaveLength(1);
    expect(screen.getAllByText(t.notRead)).toHaveLength(1); // required fat
    expect(screen.getAllByText(`${t.notRead} ${t.optional}`)).toHaveLength(2); // fibre and added sugar
    expect(field(t.name).props.value).toBe(''); // OCR does not read the name
  });

  it('shows the basis line', async () => {
    await toReview();
    expect(screen.getByText('Per 100 g')).toBeTruthy();
  });

  it('Use per serving instead swaps to the serving numbers and keeps the typed name', async () => {
    await toReview();
    await fireEvent.changeText(field(t.name), 'Granola');
    expect(field(t.calories).props.value).toBe('400');
    await fireEvent(screen.getByLabelText(t.perServing), 'valueChange', true);
    expect(field(t.calories).props.value).toBe('120');
    expect(field(t.fibre).props.value).toBe('2.4');
    expect(field(t.serving).props.value).toBe('30 g');
    expect(field(t.name).props.value).toBe('Granola');
    expect(screen.getByText(t.basisServing('30 g'))).toBeTruthy();
    await fireEvent(screen.getByLabelText(t.perServing), 'valueChange', false);
    expect(field(t.calories).props.value).toBe('400');
  });

  it('has no switch when the label has one column', async () => {
    await toReview(PARTIAL);
    expect(screen.queryByLabelText(t.perServing)).toBeNull();
  });

  it('shows each warning as a plain line', async () => {
    await toReview(LOOKS_OFF);
    expect(screen.getByText(WARNING_COPY.looks_off)).toBeTruthy();
  });

  it('keeps Add disabled until the name and the four numbers are set, with no skip', async () => {
    await toReview(PARTIAL);
    expect(addBtn().props.accessibilityState?.disabled).toBeTruthy();
    await fireEvent.changeText(field(t.name), 'Granola');
    await fireEvent.changeText(field(t.fat), '10');
    expect(addBtn().props.accessibilityState?.disabled).toBeFalsy();
    await fireEvent.changeText(field(t.calories), '');
    expect(addBtn().props.accessibilityState?.disabled).toBeTruthy();
    await fireEvent.changeText(field(t.calories), '0'); // a typed 0 is a real value
    expect(addBtn().props.accessibilityState?.disabled).toBeFalsy();
    expect(screen.queryByText(/skip/i)).toBeNull();
  });

  it('Add saves through the custom-food path with the reviewed values and logs it', async () => {
    const h = handlers();
    recognizeMock.mockResolvedValue(ok(PARTIAL));
    await toRead(h);
    await screen.findByRole('header', { name: t.reviewTitle });
    await fireEvent.changeText(field(t.name), 'Granola');
    await fireEvent.changeText(field(t.fat), '12.5');
    await fireEvent.changeText(field(t.fibre), '6');
    await fireEvent.press(addBtn());
    expect(h.onSaveMine).toHaveBeenCalledWith({ name: 'Granola', unit: '100 g', kcal: 400, protein_g: 20, carbs_g: 50, fat_g: 12.5, fibre_g: 6, added_sugar_g: null, fruit_veg_servings: null, origin: 'custom' });
    expect(h.onAdd).toHaveBeenCalledWith({ name: 'Granola', qty: 1, kcal: 400, protein_g: 20, carbs_g: 50, fat_g: 12.5, foodId: 'u1' });
    expect(h.onDone).toHaveBeenCalled();
  });

  it('with Save off, the food is logged without a saved food', async () => {
    const h = await toReview();
    await fireEvent.changeText(field(t.name), 'Granola');
    await fireEvent(screen.getByLabelText(t.save), 'valueChange', false);
    await fireEvent.press(addBtn());
    expect(h.onSaveMine).not.toHaveBeenCalled();
    expect(h.onAdd).toHaveBeenCalledWith(expect.objectContaining({ foodId: null }));
  });

  it('fibre above carbs is refused with a message and nothing is saved', async () => {
    const h = await toReview();
    await fireEvent.changeText(field(t.name), 'Granola');
    await fireEvent.changeText(field(t.fibre), '60');
    await fireEvent.press(addBtn());
    expect(await screen.findByText(t.invalid)).toBeTruthy();
    expect(h.onAdd).not.toHaveBeenCalled();
  });
});

describe('review nits (#1090)', () => {
  it('formOf leaves low and missing fields empty even when they carry a value', () => {
    const d = parseNutritionLabel(FULL);
    const field = (level: 'low' | 'missing' | 'medium' | 'high') => ({ value: 5, level, confidence: 0.3, notes: [] });
    const read = { ...d, fields: { ...d.fields, kcal: field('low'), protein_g: field('missing'), carbs_g: field('medium'), fat_g: field('high') } };
    const f = formOf(read);
    expect([f.kcal, f.protein_g, f.carbs_g, f.fat_g]).toEqual(['', '', '5', '5']);
  });

  it('the Check this marker follows the per-serving read', async () => {
    await toReview(MEDIUM_ALT);
    expect(screen.queryByText(t.check)).toBeNull();
    await fireEvent(screen.getByLabelText(t.perServing), 'valueChange', true);
    expect(screen.getAllByText(t.check)).toHaveLength(1);
    await fireEvent(screen.getByLabelText(t.perServing), 'valueChange', false);
    expect(screen.queryByText(t.check)).toBeNull();
  });

  it('a typed 12,5 is 12.5', async () => {
    const h = await toReview();
    await fireEvent.changeText(field(t.name), 'Granola');
    await fireEvent.changeText(field(t.fat), '12,5');
    await fireEvent.press(addBtn());
    expect(h.onAdd).toHaveBeenCalledWith(expect.objectContaining({ fat_g: 12.5 }));
  });

  it('a typed 1,234 is refused with an inline error and Add stays off', async () => {
    const h = await toReview();
    await fireEvent.changeText(field(t.name), 'Granola');
    await fireEvent.changeText(field(t.calories), '1,234');
    expect(screen.getByText(t.commaAmbiguous)).toBeTruthy();
    expect(addBtn().props.accessibilityState?.disabled).toBeTruthy();
    await fireEvent.press(addBtn());
    expect(h.onAdd).not.toHaveBeenCalled();
    await fireEvent.changeText(field(t.calories), '1234');
    expect(screen.queryByText(t.commaAmbiguous)).toBeNull();
    expect(addBtn().props.accessibilityState?.disabled).toBeFalsy();
  });

  it('the Not read and Check this markers are plain text, not alerts', async () => {
    await toReview(PARTIAL);
    for (const text of [t.check, t.notRead]) expect(screen.getByText(text).props.accessibilityRole).not.toBe('alert');
  });

  it('with an unknown basis, Add also needs a serving size in g or ml', async () => {
    const h = await toReview(UNKNOWN_BASIS);
    await fireEvent.changeText(field(t.name), 'Granola');
    expect(screen.getByText(t.servingNeeded)).toBeTruthy();
    expect(addBtn().props.accessibilityState?.disabled).toBeTruthy();
    await fireEvent.changeText(field(t.serving), '1 bar');
    expect(addBtn().props.accessibilityState?.disabled).toBeTruthy(); // no weight
    await fireEvent.changeText(field(t.serving), '1 bar (40 g)');
    expect(addBtn().props.accessibilityState?.disabled).toBeFalsy();
    await fireEvent.press(addBtn());
    expect(h.onSaveMine).toHaveBeenCalledWith(expect.objectContaining({ unit: '1 bar (40 g)' }));
  });

  it('the problem screen takes focus on its heading', async () => {
    const spy = jest.spyOn(AccessibilityInfo, 'setAccessibilityFocus').mockImplementation(() => undefined);
    recognizeMock.mockRejectedValue(new OcrError('failed'));
    await toRead(handlers());
    await screen.findByText(OCR_PROBLEM.failed);
    spy.mockClear();
    // focus moves when the problem view mounts: remount it through Try again then fail again
    await fireEvent.press(screen.getByRole('button', { name: t.tryAgain }));
    await fireEvent.press(await screen.findByRole('button', { name: t.take }));
    await fireEvent.press(await screen.findByRole('button', { name: t.read }));
    await screen.findByText(OCR_PROBLEM.failed);
    await waitFor(() => expect(spy).toHaveBeenCalledWith(7));
    spy.mockRestore();
  });

  it('a photo picked after the flow closed is released', async () => {
    let pick!: (v: typeof PHOTO) => void;
    take.mockReturnValue(new Promise((r) => (pick = r)));
    const view = await render(<LabelScanFlow meal="Breakfast" {...handlers()} />);
    await fireEvent.press(screen.getByRole('button', { name: t.take }));
    await view.unmount();
    release.mockClear();
    pick(PHOTO);
    await waitFor(() => expect(release).toHaveBeenCalledWith(PHOTO.uri));
  });
});

describe('privacy', () => {
  it('releases the photo once the scan ends, on success and on failure', async () => {
    await toReview();
    expect(release).toHaveBeenCalledWith(PHOTO.uri);
  });

  it('releases the photo when the scan fails', async () => {
    recognizeMock.mockRejectedValue(new OcrError('memory'));
    await toRead(handlers());
    await screen.findByText(OCR_PROBLEM.memory);
    expect(release).toHaveBeenCalledWith(PHOTO.uri);
  });

  it('releases the photo when the user backs out at the crop step', async () => {
    const h = handlers();
    await render(<LabelScanFlow meal="Breakfast" {...h} />);
    await fireEvent.press(screen.getByRole('button', { name: t.take }));
    await fireEvent.press(await screen.findByRole('button', { name: t.close }));
    expect(release).toHaveBeenCalledWith(PHOTO.uri);
    expect(h.onClose).toHaveBeenCalled();
  });
});
