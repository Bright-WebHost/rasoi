const SENT_COUNT_KEYS = ["sent", "sent_count", "sentCount", "messages_sent", "messagesSent"];
const ATTEMPTED_COUNT_KEYS = ["attempted", "attempted_count", "attemptedCount", "total", "total_count", "totalCount"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseCount(value: unknown): number | undefined {
  if (typeof value !== "number" && (typeof value !== "string" || !/^\d+$/.test(value))) return undefined;
  const count = Number(value);
  return Number.isSafeInteger(count) && count >= 0 ? count : undefined;
}

export function getBlastCount(value: unknown, keys: string[]): number | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const count = getBlastCount(item, keys);
      if (count !== undefined) return count;
    }
    return undefined;
  }
  if (!isRecord(value)) return undefined;

  for (const key of keys) {
    const count = parseCount(value[key]);
    if (count !== undefined) return count;
  }
  for (const key of ["data", "result", "response"]) {
    const count = getBlastCount(value[key], keys);
    if (count !== undefined) return count;
  }
  return undefined;
}

export function getBlastSentCount(value: unknown): number | undefined {
  return getBlastCount(value, SENT_COUNT_KEYS);
}

export function getBlastAttemptedCount(value: unknown): number | undefined {
  return getBlastCount(value, ATTEMPTED_COUNT_KEYS);
}
