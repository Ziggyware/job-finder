import { useMemo, useState } from 'react';
import { useStore } from '../store';
import type { Job } from '../types';
import JobBoards from './JobBoards';
import ApplyPack from './ApplyPack';
import FillHelper from './FillHelper';
import Tracker from './Tracker';

function jobFromDraft(draft: { title: string; company: string; location: string; remote: boolean; notes: string }): Job {
  return {
    id: 'user',
    title: draft.title.trim() || 'Role',
    company: draft.company.trim() || 'Company',
    location: draft.location.trim() || '',
    remote: draft.remote ? 'remote' : 'hybrid',
    salary: '',
    postedDaysAgo: 0,
    employment: 'full-time',
    seniority: 'mid',
    description: draft.notes,
    responsibilities: [],
    requiredSkills: [],
    niceToHave: [],
    questions: [],
    applicantCount: 0,
  };
}

export default function BriefingStage() {
  const profile = useStore((s) => s.profile)!;
  const [packOpen, setPackOpen] = useState(false);
  const [draft, setDraft] = useState({
    title: profile.titles[0] || '',
    company: '',
    location: profile.location || '',
    remote: false,
    notes: '',
  });
  const job = useMemo(() => jobFromDraft(draft), [draft]);

  return (
    <div className="mx-auto max-w-6xl px-5 py-8">
      <div className="mb-6">
        <h1 className="text-3xl font-semibold tracking-tight">Search & apply</h1>
        <p className="mt-2 max-w-2xl text-base leading-relaxed text-[var(--color-mute)]">
          Hello {profile.name.split(' ')[0] || profile.name}. Search real boards, fill the live
          form, save the posting URL. Four steps, all on this device.
        </p>
      </div>

      <JobBoards profile={profile} />
      <FillHelper profile={profile} />

      <div className="panel p-5">
        <h2 className="text-xl font-semibold tracking-tight">Apply pack for a real listing</h2>
        <p className="mt-1 text-base text-[var(--color-mute)]">
          Paste the title and company from a posting you opened. We draft fields and a letter from
          your resume — nothing is submitted.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="block text-sm text-[var(--color-mute)]">
            Job title
            <input
              className="mt-1 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-ink)] px-3 py-2.5 text-base outline-none"
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            />
          </label>
          <label className="block text-sm text-[var(--color-mute)]">
            Company
            <input
              className="mt-1 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-ink)] px-3 py-2.5 text-base outline-none"
              value={draft.company}
              onChange={(e) => setDraft({ ...draft, company: e.target.value })}
            />
          </label>
          <label className="block text-sm text-[var(--color-mute)]">
            Location
            <input
              className="mt-1 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-ink)] px-3 py-2.5 text-base outline-none"
              value={draft.location}
              onChange={(e) => setDraft({ ...draft, location: e.target.value })}
            />
          </label>
          <label className="flex items-center gap-3 self-end pb-2 text-base">
            <input
              type="checkbox"
              className="h-5 w-5"
              checked={draft.remote}
              onChange={(e) => setDraft({ ...draft, remote: e.target.checked })}
            />
            Remote
          </label>
          <label className="block text-sm text-[var(--color-mute)] sm:col-span-2">
            Notes from the posting (optional)
            <textarea
              className="mt-1 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-ink)] px-3 py-2.5 text-base outline-none"
              rows={3}
              value={draft.notes}
              onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
            />
          </label>
        </div>
        <button className="btn btn-primary mt-4 text-base" onClick={() => setPackOpen(true)} disabled={!draft.title.trim()}>
          Build apply pack
        </button>
      </div>

      <div className="mt-6">
        <Tracker />
      </div>

      {packOpen && <ApplyPack profile={profile} job={job} onClose={() => setPackOpen(false)} />}
    </div>
  );
}
