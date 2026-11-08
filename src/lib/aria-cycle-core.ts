export type AriaStepResult = { ok: boolean; [key: string]: unknown };
/** Isolate failures: a failed entry reconciliation must not prevent exits.
 * Recover old exits before scanning so a canceled partial sell can resume. */
export async function runAriaCycle(deps: {
  entries: () => Promise<AriaStepResult>;
  exits: () => Promise<AriaStepResult>;
  monitor: () => Promise<AriaStepResult>;
  reports: () => Promise<AriaStepResult>;
}) {
  const steps: Record<string, AriaStepResult> = {};
  const run = async (name: string, action: () => Promise<AriaStepResult>) => {
    try { steps[name] = await action(); }
    catch { steps[name] = { ok: false, error: 'aria_step_failed' }; }
  };
  await run('entryReconcile', deps.entries);
  await run('exitRecovery', deps.exits);
  await run('tradeMonitor', deps.monitor);
  await run('tradeReconcile', deps.exits);
  await run('tradeCloseReports', deps.reports);
  return { ok: Object.values(steps).every(step => step.ok), steps };
}
