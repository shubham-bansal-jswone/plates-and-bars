import { useEffect } from "react";
import { Pressable, Text } from "react-native";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import { createClient } from "@plate-and-bar/api";
import { ProgressScreen } from "../src/screens/ProgressScreen";
import { saveProfile } from "../src/db/records";
import { useProfile } from "../src/state/ProfileProvider";
import { ViewedDateProvider } from "../src/state/ViewedDate";
import { buildProfile, emptyDraft } from "../src/setup/logic";
import { Stores } from "../src/sync/Stores";
import {
  SyncProvider,
  useSync,
  type SyncState,
} from "../src/sync/SyncProvider";
import { fakeServer, memoryTokens, openDb } from "./sync-helpers";

// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock("expo-crypto", () => require("./sync-crypto-mock"));
jest.mock("expo-sqlite", () => ({ useSQLiteContext: () => null }));
jest.mock("../src/account/saveFile", () => ({
  RECENT_EXPORT_MS: 600000,
  clearOldExports: () => undefined,
}));
jest.mock("expo-router", () => ({
  useRouter: () => ({
    replace: jest.fn(),
    push: jest.fn(),
    back: jest.fn(),
    canGoBack: () => true,
  }),
  useFocusEffect: (cb: () => void) =>
    jest.requireActual("react").useEffect(cb, []),
}));
jest.mock("../src/photos/vault", () => ({
  POSES: ["front", "side", "back"],
  persistent: true,
  putPhoto: async () => undefined,
  getPhoto: async () => null,
  deletePhoto: async () => undefined,
  onPhotosWiped: () => () => undefined,
  photoDates: async () => [],
  wipePhotos: async () => undefined,
  announceWipe: () => undefined,
}));

const NOW = () => new Date(2026, 9, 8, 10, 0, 0);
const seen: { s: SyncState | null } = { s: null };
function Probe() {
  const s = useSync();
  useEffect(() => void (seen.s = s));
  return null;
}
/** Calls `skipSetup` directly, as the setup screen's Skip does; it does not go through Gate (no router redirect here). */
const Skip = () => {
  const { skipSetup } = useProfile();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Skip setup"
      onPress={skipSetup}
    >
      <Text>skip</Text>
    </Pressable>
  );
};
const profile = () =>
  buildProfile(
    {
      ...emptyDraft(),
      sex: "male",
      age: "30",
      unit: "cm",
      cm: "165",
      weight: "82",
      activity: "sitting",
      where: "gym",
      days: 6,
      exp: "some",
      minutes: 60,
      goal: "lose",
      pace: "moderate",
      screen: ["no", "no", "no", "no", "no", "no"],
    },
    new Date(2026, 8, 1),
  );

describe("Progress after Delete everything with setup skipped (#1371)", () => {
  it("a weigh-in saved on a past day is stored under that day, not today (real wipe, real stores)", async () => {
    const db = await openDb();
    const server = fakeServer("a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d");
    (globalThis as { fetch: unknown }).fetch = server.fetch;
    await saveProfile(db, profile());
    const tokens = memoryTokens(null);
    const api = createClient("http://fake/api/v1", async () => null);
    await render(
      <SyncProvider db={db} tokens={tokens} api={api}>
        <Stores db={db}>
          <Probe />
          <ViewedDateProvider>
            <Skip />
            <ProgressScreen db={db} now={NOW} />
          </ViewedDateProvider>
        </Stores>
      </SyncProvider>,
    );
    await screen.findByRole("header", { name: "Progress" });
    await fireEvent.press(screen.getByRole("button", { name: "Previous day" }));
    await screen.findByText("Yesterday");
    await act(
      async () =>
        void expect(
          (await seen.s!.deleteEverything({ deviceOnly: true })).kind,
        ).toBe("deleted"),
    );
    expect(await db.getFirstAsync("SELECT data FROM profiles")).toBeNull();
    await fireEvent.press(await screen.findByLabelText("Skip setup"));
    await screen.findByRole("header", { name: "Progress" });
    expect(screen.getByText("Today")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Previous day" }));
    await screen.findByText("Yesterday");
    await fireEvent.changeText(screen.getByLabelText("Weight in kg"), "81.4");
    await fireEvent.press(screen.getByLabelText("Save weight"));
    await waitFor(async () => {
      const rows = await db.getAllAsync<{ key: string; data: string }>(
        "SELECT key, data FROM weights",
      );
      expect(rows.map((r) => JSON.parse(r.data))).toEqual([
        expect.objectContaining({ date: "2026-10-07", weight_kg: 81.4 }),
      ]);
    });
  });
});
