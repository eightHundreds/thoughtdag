// Single-user vault: two computers, one person, no merge. Deletes must
// stay deleted; unsynced local edits must not vanish.

export type ProjectSyncAction =
  | 'same'
  | 'pull'
  | 'push'
  | 'delete-remote'
  | 'delete-local'
  | 'conflict';

export interface ProjectSyncInput {
  localExists: boolean;
  remoteExists: boolean;
  /** False when the local canvas has zero nodes (or no graph at all). */
  localHasContent: boolean;
  /** Hash of the last snapshot this computer successfully synced. */
  lastHash: string | null;
  localHash: string;
  remoteHash: string;
}

export function decideProjectSync(p: ProjectSyncInput): ProjectSyncAction {
  if (p.remoteExists && !p.localExists) {
    // We used to have this id (a last hash) and the user deleted the
    // canvas here: remove the vault object. Never seen it: adopt it.
    return p.lastHash ? 'delete-remote' : 'pull';
  }

  if (!p.remoteExists && p.localExists) {
    if (p.lastHash && p.lastHash === p.localHash) return 'delete-local';
    if (!p.lastHash && !p.localHasContent) return 'same';
    return 'push';
  }

  if (!p.remoteExists && !p.localExists) return 'same';

  if (p.localHash && p.remoteHash && p.localHash === p.remoteHash) return 'same';

  // First link on this computer for this shared id: an empty local
  // canvas is the factory default, not an edit. Content vs content
  // without a last hash is the only remaining conflict case.
  if (!p.lastHash) return p.localHasContent ? 'conflict' : 'pull';

  const localChanged = p.lastHash !== p.localHash;
  const remoteChanged = p.lastHash !== p.remoteHash;
  if (localChanged && remoteChanged) return 'conflict';
  if (remoteChanged && !localChanged) return 'pull';
  return 'push';
}
