export async function hydrateBootstrap({ online, readCached, loadRemote, saveRemote, setValue }) {
  let cached;
  try {
    cached = await readCached();
  } catch {
    cached = undefined;
  }
  if (cached) setValue(cached);
  if (!online) return cached;

  try {
    const remote = await loadRemote();
    await saveRemote(remote);
    setValue(remote);
    return remote;
  } catch (error) {
    if (cached) return cached;
    throw error;
  }
}
