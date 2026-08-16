import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Cloud, FolderSync, Loader2, X } from 'lucide-react';
import { useUiStore, toast } from '../../lib/ui-store';
import { backupSupported, enableAutoBackup, disableAutoBackup, backupActiveProject } from '../../lib/local-backup';
import { bootRemoteSync, loadSyncConfig, saveSyncConfig, syncNow, testSyncConnection } from '../../lib/remote-sync';
import { useT, fmt } from '../../i18n';

// Backup + remote vault. Local folder write stays Chromium-only; the
// Worker URL + storage-area name is available on every browser.

export default function BackupDialog() {
  const open = useUiStore((s) => s.backupDialogOpen);
  const dir = useUiStore((s) => s.autoBackupDir);
  const lastAt = useUiStore((s) => s.lastAutoBackupAt);
  const lastRemote = useUiStore((s) => s.lastRemoteSyncAt);
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [syncBusy, setSyncBusy] = useState(false);
  const [endpoint, setEndpoint] = useState('');
  const [area, setArea] = useState('');
  const [error, setError] = useState('');
  const [linked, setLinked] = useState(false);
  const close = () => useUiStore.getState().setBackupDialogOpen(false);

  useEffect(() => {
    if (!open) return;
    const cfg = loadSyncConfig();
    setEndpoint(cfg?.endpoint ?? '');
    setArea(cfg?.area ?? '');
    setLinked(!!cfg);
    setError('');
  }, [open]);

  if (!open) return null;

  const lastWrite = (at: number | null, written: string, never: string) =>
    at ? fmt(written, { time: new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }) : never;
  const rel = lastWrite(lastAt, t('backup.lastAt'), t('backup.lastNever'));
  const remoteRel = lastWrite(lastRemote, t('sync.lastAt'), t('sync.lastNever'));
  const configured = !!(endpoint.trim() && area);

  const saveRemote = async () => {
    setSyncBusy(true);
    setError('');
    try {
      const cfg = { endpoint: endpoint.trim().replace(/\/+$/, ''), area: area.trim() };
      await testSyncConnection(cfg);
      saveSyncConfig(cfg);
      setLinked(true);
      bootRemoteSync();
      toast('success', t('sync.connected'));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSyncBusy(false);
    }
  };

  const runSync = async () => {
    setSyncBusy(true);
    setError('');
    try {
      await syncNow();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      toast('error', fmt(t('sync.failed'), { error: message }));
    } finally {
      setSyncBusy(false);
    }
  };

  const disconnect = () => {
    saveSyncConfig(null);
    setArea('');
    setLinked(false);
    toast('info', t('sync.disconnected'));
  };

  return createPortal((
    <div className="fixed inset-0 z-[80] bg-ink/25 backdrop-blur-[2px] flex items-center justify-center animate-fade-in" onClick={close} data-backup-dialog>
      <div className="bg-surface rounded-2xl shadow-2xl border border-line w-[min(480px,92vw)] p-5 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-1">
          <div className="text-sm font-semibold text-ink flex items-center gap-2">
            <FolderSync size={15} strokeWidth={1.75} className={dir || linked ? 'text-emerald-600' : 'text-accent'} /> {t('backup.dialogTitle')}
          </div>
          <button onClick={close} className="w-7 h-7 rounded-lg text-ink-faint hover:bg-wash hover:text-ink flex items-center justify-center transition-colors">
            <X size={15} strokeWidth={1.75} />
          </button>
        </div>

        {backupSupported && (
          <section className="mb-4">
            <p className="text-xs text-ink-muted mb-3 leading-relaxed">{t('backup.dialogHow')}</p>
            {dir ? (
              <>
                <div className="text-xs bg-wash border border-line rounded-lg px-3 py-2 mb-3 space-y-0.5">
                  <div className="text-ink"><span className="text-ink-faint">{t('backup.folder')}</span> {dir}</div>
                  <div className="text-ink-muted">{rel}</div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => { setBusy(true); void backupActiveProject().then((name) => { if (name) toast('success', fmt(t('backup.wroteActive'), { name })); }).finally(() => setBusy(false)); }}
                    disabled={busy}
                    className="text-xs bg-accent hover:bg-accent-strong text-white px-4 py-2 rounded-lg transition-colors disabled:opacity-40"
                    data-backup-now
                  >
                    {t('backup.now')}
                  </button>
                  <button onClick={() => void enableAutoBackup()} className="text-xs border border-line text-ink-muted hover:bg-wash px-3 py-2 rounded-lg transition-colors">
                    {t('backup.changeFolder')}
                  </button>
                  <button onClick={() => { void disableAutoBackup(); }} className="text-xs border border-line text-ink-muted hover:bg-wash hover:text-red-600 px-3 py-2 rounded-lg transition-colors">
                    {t('backup.stop')}
                  </button>
                </div>
              </>
            ) : (
              <button
                onClick={() => void enableAutoBackup()}
                className="text-xs bg-accent hover:bg-accent-strong text-white px-4 py-2 rounded-lg transition-colors"
              >
                {t('backup.autoSetup')}
              </button>
            )}
          </section>
        )}

        <section className={backupSupported ? 'pt-4 border-t border-line' : ''}>
          <div className="text-sm font-semibold text-ink flex items-center gap-2 mb-1">
            <Cloud size={15} strokeWidth={1.75} className={linked ? 'text-emerald-600' : 'text-accent'} /> {t('sync.title')}
          </div>
          <p className="text-xs text-ink-muted mb-3 leading-relaxed">{t('sync.how')}</p>
          <label className="block text-2xs font-semibold text-ink-muted mb-1">{t('sync.endpoint')}</label>
          <input
            value={endpoint}
            onChange={(e) => setEndpoint(e.target.value)}
            placeholder={t('sync.endpointPh')}
            spellCheck={false}
            className="w-full text-xs bg-card border border-line rounded-lg px-3 py-2 mb-2 outline-none focus:border-accent/50"
          />
          <label className="block text-2xs font-semibold text-ink-muted mb-1">{t('sync.secret')}</label>
          <input
            value={area}
            onChange={(e) => setArea(e.target.value)}
            placeholder={t('sync.secretPh')}
            spellCheck={false}
            className="w-full text-xs bg-card border border-line rounded-lg px-3 py-2 mb-3 outline-none focus:border-accent/50"
          />
          {linked && <div className="text-xs text-ink-muted mb-3">{remoteRel}</div>}
          {error && <div className="text-xs text-red-600 mb-3">{error}</div>}
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => void saveRemote()}
              disabled={syncBusy || !configured}
              className="text-xs bg-accent hover:bg-accent-strong text-white px-4 py-2 rounded-lg transition-colors disabled:opacity-40 inline-flex items-center gap-1.5"
            >
              {syncBusy && <Loader2 size={12} className="animate-spin" />} {t('sync.saveTest')}
            </button>
            {linked && (
              <>
                <button
                  onClick={() => void runSync()}
                  disabled={syncBusy}
                  className="text-xs border border-line text-ink-muted hover:bg-wash px-3 py-2 rounded-lg transition-colors disabled:opacity-40"
                >
                  {t('sync.now')}
                </button>
                <button
                  onClick={disconnect}
                  disabled={syncBusy}
                  className="text-xs border border-line text-ink-muted hover:bg-wash hover:text-red-600 px-3 py-2 rounded-lg transition-colors"
                >
                  {t('sync.disconnect')}
                </button>
              </>
            )}
          </div>
        </section>
      </div>
    </div>
  ), document.body);
}
