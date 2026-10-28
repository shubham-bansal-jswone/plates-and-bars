import React from 'react';
import { FlexWidget, TextWidget } from 'react-native-android-widget';
import { dark, light, type Palette } from '../theme/tokens';
import type { WidgetData } from './data';

/** Tapping anywhere opens the Workout tab (the `plateandbar` scheme; the tabs group is not part of the path). */
const OPEN_WORKOUT = { clickAction: 'OPEN_URI', clickActionData: { uri: 'plateandbar://workout' } } as const;

/** The widget's lines, in the app's wording. */
export function widgetLines(d: WidgetData): { title: string; detail: string } {
  if (d.kind === 'rest') return { title: 'Rest day', detail: 'Nothing planned today' };
  if (d.kind === 'empty') return { title: 'Plate & Bar', detail: 'Open the app to set up your plan' };
  const n = `${d.count} ${d.count === 1 ? 'exercise' : 'exercises'}`;
  return { title: d.title, detail: d.next ? `${n}. Next: ${d.next}` : `${n}. All done for today` };
}

function Card({ d, c }: { d: WidgetData; c: Palette }) {
  const { title, detail } = widgetLines(d);
  return (
    <FlexWidget
      accessibilityLabel={`${title}. ${detail}. Opens the Workout tab.`}
      style={{ height: 'match_parent', width: 'match_parent', flexDirection: 'column', justifyContent: 'center', padding: 16, backgroundColor: c.surface as `#${string}`, borderRadius: 20 }}
      {...OPEN_WORKOUT}
    >
      <TextWidget text="Today" style={{ fontSize: 12, color: c.muted as `#${string}` }} />
      <TextWidget text={title} maxLines={1} truncate="END" style={{ fontSize: 20, fontWeight: 'bold', color: c.ink as `#${string}` }} />
      <TextWidget text={detail} maxLines={2} truncate="END" style={{ fontSize: 14, color: c.body as `#${string}` }} />
    </FlexWidget>
  );
}

/** The widget for both colour schemes (the launcher picks one from the system). */
export function renderWorkoutWidget(d: WidgetData): { light: React.JSX.Element; dark: React.JSX.Element } {
  return { light: <Card d={d} c={light} />, dark: <Card d={d} c={dark} /> };
}
