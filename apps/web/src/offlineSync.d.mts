export type PendingDraft = {
  localId: string;
  payload: any;
  createdAt: string;
  pending: boolean;
  submitAfterSync: boolean;
  serverId?: string;
  serverVersion?: number;
  syncError?: string;
};

export function syncPendingDrafts(args: {
  drafts: PendingDraft[];
  userId?: string;
  api: (path: string, options?: { method?: string; body?: string }) => Promise<any>;
  saveDraft: (draft: PendingDraft) => Promise<void>;
  deleteDraft: (localId: string) => Promise<void>;
}): Promise<Array<{ localId: string; status: 'synced' | 'conflict'; error?: string }>>;
