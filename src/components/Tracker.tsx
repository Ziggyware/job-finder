import { useState } from 'react';
import { useStore, type TrackStatus } from '../store';
import { openBoard } from '../lib/jobBoards';

const STATUSES: TrackStatus[] = ['saved', 'applied', 'interview', 'offer', 'rejected'];

export default function Tracker() {
  const tracked = useStore((s) => s.tracked);
  const addTracked = useStore((s) => s.addTracked);
  const patchTracked = useStore((s) => s.patchTracked);
  const removeTracked = useStore((s) => s.removeTracked);
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [company, setCompany] = useState('');

  return (
    <div className="panel p-5">
      <h2 className="text-xl font-semibold tracking-tight">Application tracker</h2>
      <p className="mt-1 text-base text-[var(--color-mute)]">
        Paste a real posting URL after you open it. Status stays in this browser — nothing is sent
        to a server.
      </p>
      <form
        className="mt-4 grid gap-3 sm:grid-cols-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!url.trim() && !title.trim()) return;
          addTracked({
            url: url.trim(),
            title: title.trim() || 'Untitled role',
            company: company.trim(),
            status: 'saved',
            notes: '',
          });
          setUrl('');
          setTitle('');
          setCompany('');
        }}
      >
        <input
          className="rounded-lg border border-[var(--color-line)] bg-[var(--color-ink)] px-3 py-2.5 text-base outline-none sm:col-span-3"
          placeholder="https://… job posting URL"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <input
          className="rounded-lg border border-[var(--color-line)] bg-[var(--color-ink)] px-3 py-2.5 text-base outline-none"
          placeholder="Job title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <input
          className="rounded-lg border border-[var(--color-line)] bg-[var(--color-ink)] px-3 py-2.5 text-base outline-none"
          placeholder="Company"
          value={company}
          onChange={(e) => setCompany(e.target.value)}
        />
        <button className="btn btn-primary text-base" type="submit">
          Save role
        </button>
      </form>

      <div className="mt-4 space-y-2">
        {tracked.length === 0 && (
          <p className="text-base text-[var(--color-mute-2)]">No roles saved yet.</p>
        )}
        {tracked.map((t) => (
          <div
            key={t.id}
            className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--color-line)] bg-[var(--color-ink-2)] px-3 py-2.5"
          >
            <div className="min-w-0 flex-1">
              <div className="truncate text-base font-medium">{t.title}</div>
              <div className="truncate text-sm text-[var(--color-mute)]">{t.company || t.url}</div>
            </div>
            <select
              className="rounded-lg border border-[var(--color-line)] bg-[var(--color-ink)] px-2 py-1.5 text-base"
              value={t.status}
              onChange={(e) => patchTracked(t.id, { status: e.target.value as TrackStatus })}
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            {t.url && (
              <button className="btn text-sm" type="button" onClick={() => openBoard(t.url)}>
                Open
              </button>
            )}
            <button className="btn btn-ghost text-sm" type="button" onClick={() => removeTracked(t.id)}>
              Remove
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
