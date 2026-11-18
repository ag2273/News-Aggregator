/**
 * Push failure types, kept free of React Native imports so the classification
 * can be unit-checked in Node (scripts/check-notifications.mjs).
 *
 * The distinction that matters: a build without Firebase/FCM wiring cannot mint
 * a token at all. Reporting that as "check your connection" blames the phone for
 * a packaging problem, so it gets its own kind and its own message.
 */

export type PushFailureKind =
  | 'config'
  | 'permission'
  | 'network'
  | 'auth'
  | 'server'
  | 'unknown';

export class PushError extends Error {
  kind: PushFailureKind;
  status?: number;

  constructor(kind: PushFailureKind, message: string, status?: number) {
    super(message);
    this.name = 'PushError';
    this.kind = kind;
    this.status = status;
  }
}

/** Arabic copy for each failure kind, shown as-is by the settings screen. */
export const PUSH_ERROR_MESSAGES: Record<PushFailureKind, string> = {
  config: 'الإشعارات غير مهيّأة في هذه النسخة من التطبيق. ستُفعّل في تحديث قادم.',
  permission: 'إذن الإشعارات مرفوض. فعّله من إعدادات النظام.',
  network: 'تعذّر الاتصال بالخادم. تحقق من الإنترنت وحاول مرة أخرى.',
  auth: 'انتهت صلاحية الجلسة. سجّل الدخول من جديد.',
  server: 'تعذّر حفظ التفضيلات على الخادم. حاول بعد قليل.',
  unknown: 'تعذّر إكمال العملية. حاول مرة أخرى.',
};

/**
 * Classify anything thrown while minting a push token.
 *
 * expo-notifications surfaces the native Firebase failure as a plain Error whose
 * message is "Unable to get Firebase Messaging instance. Did you configure
 * `googleServicesFile` path in app config? ..." (PushTokenModule.kt), i.e. the
 * build has no google-services.json. A missing projectId throws
 * ERR_NOTIFICATIONS_NO_EXPERIENCE_ID. A failed request to exp.host throws
 * ERR_NOTIFICATIONS_NETWORK_ERROR.
 */
export function classifyPushTokenError(err: unknown): PushFailureKind {
  const code = (err as { code?: unknown })?.code;
  const message = err instanceof Error ? err.message : String(err ?? '');

  if (code === 'ERR_NOTIFICATIONS_NO_EXPERIENCE_ID') return 'config';
  if (
    /Firebase|googleServicesFile|FirebaseApp|Messaging instance|default FirebaseApp|FIS_AUTH/i.test(
      message,
    )
  ) {
    return 'config';
  }
  if (code === 'ERR_NOTIFICATIONS_NETWORK_ERROR') return 'network';
  if (/network|Failed to fetch|timeout|ENOTFOUND|ECONNREFUSED/i.test(message)) return 'network';
  return 'unknown';
}

/** Classify a non-2xx API response. */
export function classifyHttpStatus(status: number): PushFailureKind {
  if (status === 401 || status === 403) return 'auth';
  return 'server';
}
