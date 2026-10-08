import { Platform } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SQLiteProvider } from 'expo-sqlite';
import { DB_NAME, migrate } from '../src/db/migrations';

// expo-sqlite on web needs wasm + SharedArrayBuffer; the M0 web build skips the local DB.
function Shell() {
  return (
    <>
      <StatusBar style="auto" />
      <Stack screenOptions={{ headerShown: false }} />
    </>
  );
}

export default function RootLayout() {
  if (Platform.OS === 'web') return <Shell />;
  return (
    <SQLiteProvider databaseName={DB_NAME} onInit={async (db) => void (await migrate(db))}>
      <Shell />
    </SQLiteProvider>
  );
}
