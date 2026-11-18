// Crash reporting: Firebase Crashlytics only.
//
// Scope is deliberately narrow — crash/stack data and nothing else. No analytics,
// no ad IDs, no session tracking: those need consent and none of them are in the
// product. The JS entry points are guarded so a build without the native module
// (or a dev client) cannot crash the app just because reporting is missing.

import { Platform } from 'react-native';

type Crashlytics = {
  setCrashlyticsCollectionEnabled: (enabled: boolean) => Promise<void>;
  log: (message: string) => void;
  recordError: (error: Error, jsErrorName?: string) => void;
  crash: () => void;
  setAttribute: (name: string, value: string) => Promise<void>;
  setUserId: (id: string) => Promise<void>;
};

let crashlytics: Crashlytics | null = null;
let initialised = false;

function load(): Crashlytics | null {
  if (initialised) return crashlytics;
  initialised = true;
  try {
    // Required lazily: the module is native, so it must not be imported on a
    // platform/build that lacks it (web, jest, an older APK).
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('@react-native-firebase/crashlytics').default;
    crashlytics = mod() as Crashlytics;
  } catch (err) {
    if (Platform.OS !== 'web') {
      console.warn('[crash] Crashlytics unavailable in this build:', err);
    }
    crashlytics = null;
  }
  return crashlytics;
}

/** Turn collection on. Called once at app start. */
export async function initCrashReporting(): Promise<void> {
  const c = load();
  if (!c) return;
  try {
    await c.setCrashlyticsCollectionEnabled(true);
  } catch (err) {
    console.warn('[crash] could not enable collection:', err);
  }
}

/** Attach a non-identifying context line to subsequent reports. */
export async function setCrashContext(context: Record<string, string>): Promise<void> {
  const c = load();
  if (!c) return;
  for (const [key, value] of Object.entries(context)) {
    try {
      await c.setAttribute(key, String(value).slice(0, 100));
    } catch {
      /* attributes are best effort */
    }
  }
}

/** Log a handled error (non-fatal) without crashing. */
export function recordError(error: unknown, where: string): void {
  const c = load();
  if (!c) return;
  try {
    c.log(`${where}`);
    c.recordError(error instanceof Error ? error : new Error(String(error)), where);
  } catch {
    /* never let reporting break the caller */
  }
}

/** Throw a deliberate test crash. Only reachable from the hidden gesture. */
export function crashNow(): void {
  const c = load();
  if (c) {
    c.crash();
    return;
  }
  // Still make the failure visible when Crashlytics is absent.
  throw new Error('Crashlytics test crash (module unavailable)');
}
