import { useMemo } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SQLiteProvider, useSQLiteContext } from 'expo-sqlite';
import { DB_NAME } from '../src/db/migrations';
import { initDb } from '../src/db/initDb';
import { lockedDb } from '../src/db/lockedDb';
import { ContentRefresher } from '../src/content/ContentRefresher';
import { Gate } from '../src/state/Gate';
import { FontsProvider } from '../src/theme/fonts';
import { syncDb } from '../src/sync/db';
import { SyncBadge } from '../src/sync/SyncBadge';
import { Stores } from '../src/sync/Stores';
import { SyncProvider } from '../src/sync/SyncProvider';
import { registerServiceWorker } from '../src/web/registerServiceWorker';

registerServiceWorker(); // production web only: offline start (#718)

function Providers() {
  const sqlite = useSQLiteContext();
  // Everything that writes goes through the app write lock; sync transactions take the same lock on the raw database.
  const db = useMemo(() => lockedDb(sqlite), [sqlite]);
  const sdb = useMemo(() => syncDb(sqlite), [sqlite]);
  return (
    <SyncProvider db={sdb}>
      <Stores db={db}>
        <ContentRefresher />
        <StatusBar style="auto" />
        <Stack screenOptions={{ headerShown: false }} />
        <Gate />
        <SyncBadge />
      </Stores>
    </SyncProvider>
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
