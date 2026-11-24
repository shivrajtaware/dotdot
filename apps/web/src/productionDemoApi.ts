export const DEMO_BOOTSTRAP = null as any;
export const DEMO_USER = null as any;

export async function demoApi(): Promise<never> {
  throw new Error('Demo data is disabled in production.');
}
