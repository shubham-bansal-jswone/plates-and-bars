// Local Expo config plugin: the Android home-screen widget (#1181), only when the build sets EXPO_PUBLIC_HOME_WIDGET=1.
// With the flag off this returns the config untouched, so prebuild adds no provider, receiver or widget XML. The flag is read
// at prebuild time (app.json cannot branch), the same variable the app reads at runtime (src/widget/flag.ts).
// The widget itself is drawn by react-native-android-widget (MIT): its plugin writes the receiver into the manifest, the
// provider class and the appwidget-provider XML.
const withAndroidWidgets = require('react-native-android-widget/app.plugin').default;

/** The widget's name: the receiver class and `requestWidgetUpdate` use it. src/widget/flag.ts has the same value (a test compares them). */
const WIDGET_NAME = 'TodayWorkout';

/** The platform's shortest automatic update period (30 minutes): the only scheduled refresh, so a new day shows within half an hour of midnight. */
const UPDATE_PERIOD_MS = 30 * 60 * 1000;

const widgets = [
  {
    name: WIDGET_NAME,
    label: 'Today’s workout',
    description: 'Today’s planned workout and the next exercise. Tap to open the Workout tab.',
    // 4x2 cells; the sizes are the launcher's minimums for that grid.
    minWidth: '250dp',
    minHeight: '110dp',
    targetCellWidth: 4,
    targetCellHeight: 2,
    resizeMode: 'horizontal|vertical',
    updatePeriodMillis: UPDATE_PERIOD_MS,
    // Workout names stay off the lock screen.
    widgetCategory: 'not_keyguard',
  },
];

function withHomeWidget(config, env = process.env) {
  if (env.EXPO_PUBLIC_HOME_WIDGET !== '1') return config;
  return withAndroidWidgets(config, { widgets });
}

module.exports = withHomeWidget;
module.exports.WIDGET_NAME = WIDGET_NAME;
module.exports.UPDATE_PERIOD_MS = UPDATE_PERIOD_MS;
module.exports.widgets = widgets;
