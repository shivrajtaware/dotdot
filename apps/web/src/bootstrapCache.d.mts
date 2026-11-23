export function hydrateBootstrap(options: {
  online: boolean;
  readCached: () => Promise<any>;
  loadRemote: () => Promise<any>;
  saveRemote: (value: any) => Promise<unknown>;
  setValue: (value: any) => void;
}): Promise<any>;
