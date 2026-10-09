import { useMemo } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SQLiteProvider, useSQLiteContext } from 'expo-sqlite';
import type { SQLiteDatabase } from 'expo-sqlite';
import { DB_NAME, MIGRATIONS, migrate } from '../src/db/migrations';
import { lockedDb } from '../src/db/lockedDb';
import { Gate } from '../src/state/Gate';
import { FontsProvider } from '../src/theme/fonts';
import { syncDb } from '../src/sync/db';
import type { SyncDb } from '../src/sync/engine';
import { SyncBadge } from '../src/sync/SyncBadge';
import { Stores } from '../src/sync/Stores';
import { ApiContext, SyncProvider, useSync } from '../src/sync/SyncProvider';
import { AiProvider } from '../src/ai/AiProvider';
import { useContext, type ReactNode } from 'react';

async function initDb(db: SQLiteDatabase): Promise<void> {
  const version = await migrate(db);
  if (version > MIGRATIONS.length) {
    console.warn(`Local database schema v${version} is newer than this app (v${MIGRATIONS.length}).`);
  }
}

/** AI features, off until the user opts in; needs the sync provider's client and sign-in state. */
function Ai({ db, children }: { db: SyncDb; children: ReactNode }) {
  const { signedIn } = useSync();
  const t = useContext(ApiContext);
  return t ? <AiProvider db={db} api={t.api} tokens={t.tokens} signedIn={signedIn}>{children}</AiProvider> : <>{children}</>;
}

function Providers() {
  const sqlite = useSQLiteContext();
  // Everything that writes goes through the app write lock; sync transactions take the same lock on the raw database.
  const db = useMemo(() => lockedDb(sqlite), [sqlite]);
  const sdb = useMemo(() => syncDb(sqlite), [sqlite]);
  return (
    <SyncProvider db={sdb}>
      <Ai db={sdb}>
        <Stores db={db}>
          <StatusBar style="auto" />
          <Stack screenOptions={{ headerShown: false }} />
          <Gate />
          <SyncBadge />
        </Stores>
      </Ai>
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
