import { useSyncExternalStore } from "react";
import { getJson, sendJson, type Settings } from "../api";

/**
 * Parts of the tool that are off until they are switched on under
 * Inställningar › Moduler: Lön (the salary forecast from payslips) and
 * Pendling & bränsle. The server keeps the choice (/api/settings); this keeps
 * the answer for the menus, and loads it once.
 */
export type ModuleId = "salary" | "commute";
export type Modules = Record<ModuleId, boolean>;

export const MODULE_INFO: Record<ModuleId, { label: string; hint: string }> = {
  salary: {
    label: "Lön",
    hint: "löneprognos för timlön och månadslön med OB, mertid och övertid, uträknad ur lönespecar (Hogias webbspec, .htm eller PDF). Avtalets satser och gränser lägger du in själv under Inställningar › Lön. Mest till för timanställda med OB.",
  },
  commute: {
    label: "Pendling & bränsle",
    hint: "arbetspass, körsträcka och vad bilen behöver för att komma till jobbet, som en prognos för tankningen. Fungerar bäst med skiftarbete.",
  },
};

interface State {
  loaded: boolean;
  modules: Modules;
}

let state: State = { loaded: false, modules: { salary: false, commute: false } };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const set = (next: State) => {
  state = next;
  emit();
};

let loading: Promise<void> | null = null;

/** Asks the server once which modules are on; a failed answer leaves them off. */
export function loadModules(): Promise<void> {
  loading ??= getJson<Settings>("/settings").then(
    (s) => set({ loaded: true, modules: { salary: s.modules?.salary === true, commute: s.modules?.commute === true } }),
    () => set({ ...state, loaded: true }),
  );
  return loading;
}

/** Switches a module on or off, at once in the menus and then on the server. */
export async function setModule(id: ModuleId, on: boolean): Promise<void> {
  const before = state;
  set({ loaded: true, modules: { ...state.modules, [id]: on } });
  try {
    const s = await sendJson<Settings>("PUT", "/settings", { modules: { [id]: on } });
    set({ loaded: true, modules: { salary: s.modules?.salary === true, commute: s.modules?.commute === true } });
  } catch (e) {
    set(before);
    throw e;
  }
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

/** Which modules are on, and whether the server has said yet. */
export function useModules(): State {
  return useSyncExternalStore(subscribe, () => state);
}

/** For tests: forget what was loaded, or start from a given answer. */
export function resetModules(modules: Modules = { salary: false, commute: false }, loaded = false) {
  state = { loaded, modules };
  loading = loaded ? Promise.resolve() : null;
  emit();
}
