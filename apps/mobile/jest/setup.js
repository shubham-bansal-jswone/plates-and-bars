// Screens read the bottom safe-area inset (#1059); the app's SafeAreaProvider is absent in tests, so use the library's own mock (insets 0).
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);

// Existing component tests were written against the system-following theme (light by default, dark when mocked); the app itself
// defaults to the dark identity. Tests of the default set EXPO_PUBLIC_THEME themselves (theme-default.test.ts).
process.env.EXPO_PUBLIC_THEME = 'system';
