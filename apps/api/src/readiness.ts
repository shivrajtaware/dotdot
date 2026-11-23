export async function databaseReadiness(probe: () => Promise<unknown>) {
  try {
    await probe();
    return { status: 'ok' as const, database: 'ok' as const };
  } catch {
    return { status: 'unavailable' as const, database: 'unavailable' as const };
  }
}
