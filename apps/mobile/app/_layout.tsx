import { Platform } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SQLiteProvider } from 'expo-sqlite';
import type { SQLiteDatabase } from 'expo-sqlite';
import { DB_NAME, MIGRATIONS, migrate } from '../src/db/migrations';

async function initDb(db: SQLiteDatabase): Promise<void> {
  const version = await migrate(db);
  if (version > MIGRATIONS.length) {
    console.warn(`Local database schema v${version} is newer than this app (v${MIGRATIONS.length}).`);
  }
}

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
    <SQLiteProvider databaseName={DB_NAME} onInit={initDb}>
      <Shell />
    </SQLiteProvider>
  );
}
