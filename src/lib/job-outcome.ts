/** Preserve the execution error for API and Telegram approval consumers. */
export function executionOutcome<T extends { ok: boolean; error?: string; code?: string }>(execution: T) {
  return execution.ok
    ? { ok: true as const, execution }
    : { ok: false as const, error: execution.error || 'خطای نامشخص در اجرای کار', code: execution.code, execution };
}
