import { load, Store } from "@tauri-apps/plugin-store";
import { DEFAULT_SETTINGS, Settings } from "./types";

let store: Store | null = null;

async function getStore(): Promise<Store> {
  if (!store) {
    store = await load("settings.json", { autoSave: true, defaults: {} });
  }
  return store;
}

export async function loadSettings(): Promise<Settings> {
  const s = await getStore();
  const saved = (await s.get<Partial<Settings>>("settings")) ?? {};
  return { ...DEFAULT_SETTINGS, ...saved };
}

export async function saveSettings(settings: Settings): Promise<void> {
  const s = await getStore();
  await s.set("settings", settings);
  await s.save();
}
