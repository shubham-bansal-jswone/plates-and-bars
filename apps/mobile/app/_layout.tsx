import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SQLiteProvider, useSQLiteContext } from 'expo-sqlite';
import type { SQLiteDatabase } from 'expo-sqlite';
import { DB_NAME, MIGRATIONS, migrate } from '../src/db/migrations';
import { ProfileProvider } from '../src/state/ProfileProvider';
import { SettingsProvider } from '../src/state/SettingsProvider';
import { Gate } from '../src/state/Gate';

async function initDb(db: SQLiteDatabase): Promise<void> {
  const version = await migrate(db);
  if (version > MIGRATIONS.length) {
    console.warn(`Local database schema v${version} is newer than this app (v${MIGRATIONS.length}).`);
  }
}

function Providers() {
  const db = useSQLiteContext();
  return (
    <ProfileProvider db={db}>
      <SettingsProvider db={db}>
        <StatusBar style="auto" />
        <Stack screenOptions={{ headerShown: false }} />
        <Gate />
      </SettingsProvider>
    </ProfileProvider>
  );
}

// Same database and migrations on Android, iOS and web (web uses expo-sqlite's wasm build).
export default function RootLayout() {
  return (
    <SQLiteProvider databaseName={DB_NAME} onInit={initDb}>
      <Providers />
    </SQLiteProvider>
  );
}
