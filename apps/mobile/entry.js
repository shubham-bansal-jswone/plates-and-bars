// App entry. Same as expo-router/entry, plus the home-screen widget's task handler (#1181): the launcher can run it with the
// app closed, so it must be registered when the bundle loads, not from a screen. Only with the flag on, on Android.
import 'expo-router/entry';

if (process.env.EXPO_PUBLIC_HOME_WIDGET === '1' && require('react-native').Platform.OS === 'android') {
  require('./src/widget/handler').registerHomeWidget();
}
