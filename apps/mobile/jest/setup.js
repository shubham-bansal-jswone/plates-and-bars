// Screens read the bottom safe-area inset (#1059); the app's SafeAreaProvider is absent in tests, so use the library's own mock (insets 0).
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
