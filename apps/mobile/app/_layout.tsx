import { useMemo } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SQLiteProvider, useSQLiteContext } from 'expo-sqlite';
import type { SQLiteDatabase } from 'expo-sqlite';
import { DB_NAME, MIGRATIONS, migrate } from '../src/db/migrations';
import { ProfileProvider } from '../src/state/ProfileProvider';
import { SettingsProvider } from '../src/state/SettingsProvider';
import { Gate } from '../src/state/Gate';
import { FontsProvider } from '../src/theme/fonts';
import { syncDb } from '../src/sync/db';
import { SyncBadge } from '../src/sync/SyncBadge';
import { SyncProvider, useSync } from '../src/sync/SyncProvider';

async function initDb(db: SQLiteDatabase): Promise<void> {
  const version = await migrate(db);
  if (version > MIGRATIONS.length) {
    console.warn(`Local database schema v${version} is newer than this app (v${MIGRATIONS.length}).`);
  }
}

function Providers() {
  const db = useSQLiteContext();
  const sdb = useMemo(() => syncDb(db), [db]);
  return (
    <SyncProvider db={sdb}>
      <Stores db={db} />
    </SyncProvider>
  );
}

// A wiped local store (account switch, discard) remounts the providers so they reload from the empty database.
function Stores({ db }: { db: SQLiteDatabase }) {
  const { epoch } = useSync();
  return (
    <ProfileProvider key={epoch} db={db}>
      <SettingsProvider db={db}>
        <StatusBar style="auto" />
        <Stack screenOptions={{ headerShown: false }} />
        <Gate />
        <SyncBadge />
      </SettingsProvider>
    </ProfileProvider>
  );
}

// Same database and migrations on Android, iOS and web (web uses expo-sqlite's wasm build).
export default function RootLayout() {
  return (
    <FontsProvider>
      <SQLiteProvider databaseName={DB_NAME} onInit={initDb}>
        <Providers />
      </SQLiteProvider>
    </FontsProvider>
  );
}
