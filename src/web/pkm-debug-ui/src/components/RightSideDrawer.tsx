import type { ReactNode } from 'react';

interface RightSideDrawerProps {
  open: boolean;
  title: string;
  subtitle?: string | null;
  onClose: () => void;
  children: ReactNode;
}

export function RightSideDrawer({
  open,
  title,
  subtitle,
  onClose,
  children,
}: RightSideDrawerProps) {
  if (!open) return null;

  return (
    <>
      <button
        type="button"
        aria-label="Close drawer backdrop"
        className="fixed inset-0 z-40 bg-slate-950/70"
        onClick={onClose}
      />
      <aside className="fixed inset-y-0 right-0 z-50 w-full max-w-[620px] border-l border-slate-800 bg-slate-950/95 shadow-2xl">
        <div className="flex h-full min-h-0 flex-col">
          <div className="border-b border-slate-800 px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-slate-100">{title}</div>
                {subtitle && (
                  <div className="mt-1 text-xs text-slate-400">{subtitle}</div>
                )}
              </div>
              <button
                type="button"
                className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-200 hover:bg-slate-800"
                onClick={onClose}
              >
                Close
              </button>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {children}
          </div>
        </div>
      </aside>
    </>
  );
}
