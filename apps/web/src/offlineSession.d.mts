export function readCachedManager(readCachedProfile: () => Promise<any>): Promise<any>;
export function shouldPersistLocally(online: boolean, offlineOnly: boolean): boolean;
export function canSyncOfflineDrafts(online: boolean, hasAccessToken: boolean, offlineOnly: boolean): boolean;
