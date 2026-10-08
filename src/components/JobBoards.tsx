import { useMemo, useState } from 'react';
import type { ResumeProfile } from '../types';
import { boardLinks, defaultQueryFromProfile, openAllBoards, openBoard, type BoardQuery } from '../lib/jobBoards';

export default function JobBoards({ profile }: { profile: ResumeProfile }) {
  const [query, setQuery] = useState<BoardQuery>(() => defaultQueryFromProfile(profile));
  const links = useMemo(() => boardLinks(query), [query]);
  const suggestions = useMemo(() => {
    const titles = profile.titles.slice(0, 4);
    const skills = profile.skills.slice(0, 6);
    return [...new Set([...titles, ...skills])];
  }, [profile]);

  return (
    <div className="panel mb-6 p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Search major job boards</h2>
          <p className="mt-1 max-w-2xl text-base leading-relaxed text-[var(--color-mute)]">
            Opens the real search pages on LinkedIn, Indeed, Glassdoor, Google Jobs and more — using
            your title, skills and location. Nothing is scraped; you apply on the board itself.
          </p>
        </div>
        <button className="btn btn-primary text-base" onClick={() => openAllBoards(links)}>
          Open top 6 boards
        </button>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <label className="block text-sm text-[var(--color-mute)]">
          Keywords / title
          <input
            value={query.keywords}
            onChange={(e) => setQuery({ ...query, keywords: e.target.value })}
            className="mt-1 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-ink)] px-3 py-2.5 text-base outline-none focus:border-[var(--color-pilot)]"
            placeholder="Senior frontend engineer"
          />
        </label>
        <label className="block text-sm text-[var(--color-mute)]">
          Location
          <input
            value={query.location}
            onChange={(e) => setQuery({ ...query, location: e.target.value })}
            className="mt-1 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-ink)] px-3 py-2.5 text-base outline-none focus:border-[var(--color-pilot)]"
            placeholder="San Francisco, CA"
          />
        </label>
        <label className="flex items-center gap-3 self-end pb-2 text-base">
          <input
            type="checkbox"
            checked={query.remote}
            onChange={(e) => setQuery({ ...query, remote: e.target.checked })}
            className="h-5 w-5"
          />
          Remote roles
        </label>
      </div>

      {suggestions.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              className="chip cursor-pointer text-sm"
              onClick={() => setQuery({ ...query, keywords: s })}
            >
              {s}
            </button>
          ))}
        </div>
      )}

      <div className="mt-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {links.map((b) => (
          <button
            key={b.id}
            type="button"
            onClick={() => openBoard(b.url)}
            className="card-hover flex items-start justify-between gap-3 rounded-xl border border-[var(--color-line)] bg-[var(--color-ink-2)] px-4 py-3 text-left"
          >
            <span>
              <span className="block text-base font-semibold">{b.name}</span>
              <span className="mt-0.5 block text-sm text-[var(--color-mute)]">{b.blurb}</span>
            </span>
            <span className="shrink-0 text-base text-[var(--color-pilot)]">↗</span>
          </button>
        ))}
      </div>
    </div>
  );
}
