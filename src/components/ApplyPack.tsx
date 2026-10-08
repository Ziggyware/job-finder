import { useMemo, useState } from 'react';
import type { Job, ResumeProfile } from '../types';
import { buildApplyPack, copyText, downloadText } from '../lib/applyPack';
import { openBoard } from '../lib/jobBoards';

export default function ApplyPack({ profile, job, onClose }: { profile: ResumeProfile; job: Job; onClose: () => void }) {
  const pack = useMemo(() => buildApplyPack(profile, job), [profile, job]);
  const [copied, setCopied] = useState(false);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center" onClick={onClose}>
      <div
        className="panel max-h-[90vh] w-full max-w-2xl overflow-auto p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold">Apply pack</h2>
            <p className="mt-1 text-base text-[var(--color-mute)]">{pack.headline}</p>
          </div>
          <button className="btn" onClick={onClose}>
            Close
          </button>
        </div>
        <p className="mt-3 text-base leading-relaxed text-[var(--color-mute)]">
          JobPilot cannot type into another site from this tab. Use the JobPilot Fill bookmarklet
          on the application page, or copy fields below. Salary, work authorisation, and captchas
          stay yours. You submit.
        </p>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            className="btn btn-primary"
            onClick={async () => {
              const ok = await copyText(pack.plainText);
              setCopied(ok);
            }}
          >
            {copied ? 'Copied' : 'Copy entire pack'}
          </button>
          <button
            className="btn"
            onClick={() =>
              downloadText(
                `apply-${job.company.replace(/\s+/g, '-').toLowerCase()}.txt`,
                pack.plainText,
              )
            }
          >
            Download .txt
          </button>
        </div>

        <div className="mt-4 space-y-3">
          {pack.fields.map((f) => (
            <div key={f.label} className="rounded-xl border border-[var(--color-line)] bg-[var(--color-ink-2)] p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-medium text-[var(--color-mute)]">{f.label}</div>
                <button
                  className="btn btn-ghost text-sm"
                  onClick={() => copyText(f.value)}
                  disabled={!f.value}
                >
                  Copy
                </button>
              </div>
              <pre className="mt-1 whitespace-pre-wrap text-base leading-relaxed">{f.value || '—'}</pre>
            </div>
          ))}
        </div>

        <h3 className="mt-5 text-lg font-semibold">Open this search on a board</h3>
        <div className="mt-2 flex flex-wrap gap-2">
          {pack.boardUrls.map((b) => (
            <button key={b.name} className="btn" onClick={() => openBoard(b.url)}>
              {b.name} ↗
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
