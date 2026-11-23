export async function readCachedManager(readCachedProfile) {
  try {
    const profile = await readCachedProfile();
    return profile?.role === 'MANAGER' && profile.id ? profile : null;
  } catch {
    return null;
  }
}

export function shouldPersistLocally(online, offlineOnly) {
  return !online || offlineOnly;
}

export function canSyncOfflineDrafts(online, hasAccessToken, offlineOnly) {
  return online && hasAccessToken && !offlineOnly;
}
