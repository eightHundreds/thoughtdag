import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';
import { useUiStore, type ToastItem } from '../../lib/ui-store';
import { useViewportMode } from '../../lib/use-viewport-mode';
import { useKeyboardInset } from '../../lib/use-keyboard-inset';

const KIND_STYLES: Record<ToastItem['kind'], string> = {
  error: 'border-red-200 bg-red-50 text-red-700',
  success: 'border-green-200 bg-green-50 text-green-700',
  info: 'border-line bg-card text-ink-muted',
};

const KIND_ICONS: Record<ToastItem['kind'], typeof Info> = {
  error: AlertCircle,
  success: CheckCircle2,
  info: Info,
};

export default function Toaster() {
  const toasts = useUiStore((s) => s.toasts);
  const dismissToast = useUiStore((s) => s.dismissToast);
  const { narrowChrome, sheet } = useViewportMode();
  const keyboardInset = useKeyboardInset();
  const panelOpen = useUiStore((s) => s.panelOpen);

  if (toasts.length === 0) return null;

  const sheetKeyboard = sheet && panelOpen && keyboardInset > 0;
  const pos = narrowChrome
    ? sheetKeyboard
      ? 'top-4 left-1/2 -translate-x-1/2 w-[min(380px,calc(100vw-24px))]'
      : 'bottom-[max(16px,env(safe-area-inset-bottom))] left-1/2 -translate-x-1/2 w-[min(380px,calc(100vw-24px))]'
    : 'bottom-4 right-4 max-w-[380px]';

  return (
    <div className={`fixed z-[90] flex flex-col gap-2 ${pos}`}>
      {toasts.map((t) => {
        const Icon = KIND_ICONS[t.kind];
        return (
          <div
            key={t.id}
            className={`flex items-start gap-2.5 border rounded-xl shadow-lg px-4 py-3 animate-fade-in ${KIND_STYLES[t.kind]}`}
          >
            <Icon size={16} strokeWidth={1.75} className="shrink-0 mt-0.5" />
            {/* message owns the full row; the action drops below it — a long
                action label once crushed the message to two chars a line */}
            <div className="flex-1 min-w-0">
              <p className="text-xs leading-relaxed break-words">{t.message}</p>
              {t.action && (
                <button
                  onClick={() => { t.action!.run(); dismissToast(t.id); }}
                  className="mt-2 text-2xs font-medium bg-accent/10 text-accent hover:bg-accent/20 px-2.5 py-1 rounded-lg transition-colors"
                >
                  {t.action.label}
                </button>
              )}
            </div>
            <button
              onClick={() => dismissToast(t.id)}
              className="shrink-0 opacity-50 hover:opacity-100 transition-opacity"
            >
              <X size={14} strokeWidth={1.75} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
