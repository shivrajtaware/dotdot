export type InitialBalances = { openingStock: Record<string, number>; openingCumulative: Record<string, number> };

export function readInitialBalances(env: Record<string, string | undefined>, gradeCodes: string[]): InitialBalances {
  if (env.CONFIRM_INITIAL_BALANCES?.trim().toLowerCase() !== 'true') {
    throw new Error('Verify the factory opening stock and cumulative balances, then set CONFIRM_INITIAL_BALANCES=true before seeding.');
  }
  const readValues = (prefix: 'OPENING' | 'CUMULATIVE') => Object.fromEntries(gradeCodes.map(code => {
    const key = `${prefix}_${code.replaceAll(' ', '_')}`;
    const raw = env[key]?.trim();
    if (!raw || !/^\d+$/.test(raw)) throw new Error(`${key} must be a non-negative whole number of bags.`);
    const quantity = Number(raw);
    if (!Number.isSafeInteger(quantity)) throw new Error(`${key} must be a safe whole-number quantity.`);
    return [code, quantity];
  }));

  return { openingStock: readValues('OPENING'), openingCumulative: readValues('CUMULATIVE') };
}

export function validateSeasonStartDate(value: string | undefined) {
  const date = value?.trim() || '2026-10-01';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('SEASON_START_DATE must use YYYY-MM-DD format.');
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) throw new Error('SEASON_START_DATE must be a real calendar date.');
  return parsed;
}

export function validateSeedSeasonChoice(activeSeasonName: string | null | undefined, requestedSeasonName: string) {
  if (activeSeasonName && activeSeasonName !== requestedSeasonName) {
    throw new Error(`The database already has active season "${activeSeasonName}". Create another season through the owner settings instead of seeding a second active season.`);
  }
}
