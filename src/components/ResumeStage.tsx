import { useCallback, useRef, useState } from 'react';
import { extractResumeText } from '../lib/extractText';
import { rankJobs } from '../lib/match';
import { JOBS } from '../data/jobs';
import { profileResume } from '../lib/resume';
import { useStore } from '../store';
import { ai } from '../ai/instance';
import { summarizeProfile } from '../ai/tasks';
import { cx } from '../lib/util';

const SAMPLE = `DANA OKAFOR
San Francisco, CA · dana.okafor@example.com · +1 415 555 0142
github.com/danaokafor · linkedin.com/in/danaokafor

SUMMARY
Frontend-leaning full stack engineer with 8+ years of experience building
collaborative web applications. I care about frame budgets, accessibility and
shipping small. Comfortable owning a feature from schema to pixel.

EXPERIENCE
Senior Frontend Engineer — Loomline (2021 - Present)
- Rebuilt the canvas renderer in WebGL, lifting median frame rate from 34 to 59
  fps on a 2017 MacBook Pro and cutting main-thread blocking by 71%.
- Led the migration of 480 components to TypeScript and a versioned design
  system adopted by 6 product teams.
- Added Playwright coverage for the 30 highest-traffic flows; flaky tests down
  from 14% to under 1%.

Full Stack Engineer — Marigold Health (2018 - 2021)
- Shipped the intake and scheduling product end to end: React, Node.js,
  PostgreSQL, GraphQL.
- Cut p95 API latency from 900ms to 210ms by adding caching and fixing N+1s.

Software Engineer — Beacon Row (2016 - 2018)
- Built internal tooling in Python and React for the on-call team.

EDUCATION
BS Computer Science, University of Washington, 2016

SKILLS
React, TypeScript, JavaScript, Node.js, WebGL, WebGPU, GraphQL, PostgreSQL,
Python, performance optimization, accessibility, design systems, Playwright,
Docker, AWS, CI/CD, testing, Git`;

export default function ResumeStage() {
  const profile = useStore((s) => s.profile);
  const profileFile = useStore((s) => s.profileFile);
  const aiSummary = useStore((s) => s.aiSummary);
  const busy = useStore((s) => s.busyExtracting);
  const setProfile = useStore((s) => s.setProfile);
  const setBusy = useStore((s) => s.setBusyExtracting);
  const setAiSummary = useStore((s) => s.setAiSummary);
  const setMatches = useStore((s) => s.setMatches);
  const log = useStore((s) => s.log);
  const engine = useStore((s) => s.engine);
  const phase = useStore((s) => s.phase);
  // A run holds its own copy of the profile; swapping the resume under it would leave the UI lying about what it used.
  const runActive = phase === 'running' || phase === 'paused';

  const [drag, setDrag] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [tab, setTab] = useState<'profile' | 'raw'>('profile');
  const inputRef = useRef<HTMLInputElement>(null);
  // Each ingest takes a ticket; a slower, older parse must not overwrite a newer resume when it finishes late.
  const ingestSeq = useRef(0);

  const ingest = useCallback(
    async (text: string, filename: string, warn: string[] = []) => {
      const ticket = ++ingestSeq.current;
      const current = () => ticket === ingestSeq.current;
      setError(null);
      setWarnings(warn);
      const parsed = profileResume(text);
      if (parsed.rawText.length < 60) {
        setError('That did not yield enough text to work with. Try pasting the resume text instead.');
        return;
      }
      // Set the profile and the ranking before anything awaits, so the Briefing never shows the previous resume's matches.
      setProfile(parsed, filename);
      setAiSummary('');
      const criteria = useStore.getState().criteria;
      const matches = rankJobs(parsed, JOBS, {
        maxAgeDays: criteria.maxAgeDays,
        remoteOnly: criteria.remoteOnly,
      });
      setMatches(matches);
      log(
        'info',
        `Resume ingested on this device: ${filename} → ${parsed.skills.length} skills recognised, ${parsed.yearsExperience} years of experience inferred.`,
      );
      log('good', `Ranked ${matches.length} postings against the resume. Top match: ${matches[0]?.score ?? 0}/100.`);
      if (ai.ready) {
        log('ai', 'Local model produced a candidate summary without any network call.');
      } else {
        log(
          'warn',
          'No local model loaded — ranking with rule-based evidence scoring and template drafts. Open the model panel to run an open-weight model on your GPU for AI-written cover letters and answers.',
        );
      }
      // The summary is the only slow part, and it is cosmetic: it arrives last and only if still current.
      const summary = await summarizeProfile(ai.ready ? ai : null, parsed);
      if (current()) setAiSummary(summary);
    },
    [ai, log, setAiSummary, setMatches, setProfile],
  );

  const onFiles = useCallback(
    async (file: File | undefined) => {
      if (!file || runActive) return;
      setBusy(true);
      setError(null);
      try {
        const result = await extractResumeText(file);
        await ingest(result.text, file.name, result.warnings);
      } catch (e) {
        setError(`Could not read that file: ${(e as Error).message}. Try a PDF, DOCX, or paste the text.`);
      } finally {
        setBusy(false);
      }
    },
    [ingest, setBusy, runActive],
  );

  return (
    <div className="mx-auto max-w-5xl px-5 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Start with your resume</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[var(--color-mute)]">
          The file is parsed in this tab and never uploaded. Extraction runs with pdf.js and a private copy of the
          profiler; the summary and every later draft come from a language model running on your own GPU.
        </p>
      </div>

      {!profile && (
        <>
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDrag(true);
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDrag(false);
              void onFiles(e.dataTransfer.files[0]);
            }}
            onClick={() => inputRef.current?.click()}
            className={cx(
              'flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed p-12 text-center transition-all',
              drag
                ? 'border-[var(--color-pilot)] bg-[#181307]'
                : 'border-[var(--color-line-2)] bg-[var(--color-ink-2)] hover:border-[var(--color-line-2)] hover:bg-[var(--color-panel)]',
            )}
          >
            <input
              ref={inputRef}
              type="file"
              accept=".pdf,.docx,.txt,.md,.rtf,application/pdf"
              className="hidden"
              onChange={(e) => {
                // Read the file, then clear the input: otherwise picking the same file again fires no change event.
                const file = e.target.files?.[0];
                e.target.value = '';
                void onFiles(file);
              }}
            />
            <div className="mb-3 text-3xl">{busy ? '⏳' : '📄'}</div>
            <div className="text-sm font-medium">
              {busy ? 'Parsing on this device…' : 'Drop your resume here, or click to choose'}
            </div>
            <div className="mt-1.5 text-xs text-[var(--color-mute-2)]">
              PDF · DOCX · TXT · MD · RTF — parsed locally, never uploaded
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button className="btn" onClick={() => setPasteOpen((v) => !v)}>
              ✎ Paste resume text instead
            </button>
            <button
              className="btn btn-ghost"
              onClick={() => {
                void ingest(SAMPLE, 'sample-resume.txt');
              }}
            >
              Try the sample résumé →
            </button>
            <span className="text-xs text-[var(--color-mute-2)]">
              No PDF handy? The sample is a real frontend engineer's resume.
            </span>
          </div>

          {pasteOpen && (
            <div className="panel mt-4 p-4">
              <textarea
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                placeholder="Paste the full text of your resume…"
                className="mono h-56 w-full resize-y rounded-xl border border-[var(--color-line)] bg-[var(--color-ink)] p-3 text-xs leading-relaxed outline-none focus:border-[var(--color-line-2)]"
              />
              <div className="mt-3 flex justify-end gap-2">
                <button className="btn btn-ghost" onClick={() => setPasteOpen(false)}>
                  Cancel
                </button>
                <button
                  className="btn btn-primary"
                  disabled={pasteText.trim().length < 60}
                  onClick={() => void ingest(pasteText, 'pasted-resume.txt')}
                >
                  Parse this text
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {error && (
        <div className="mt-4 rounded-xl border border-[#5a2626] bg-[#1d0f0f] p-3 text-xs text-[#ffb4b4]">{error}</div>
      )}

      {warnings.map((w) => (
        <div
          key={w}
          className="mt-3 rounded-xl border border-[var(--color-pilot-dim)] bg-[#1b1405] p-3 text-xs leading-relaxed text-[#ffd88a]"
        >
          ⚠ {w}
        </div>
      ))}

      {profile && (
        <div className="mt-6 grid gap-4 lg:grid-cols-[1.15fr_1fr]">
          <div className="panel p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-semibold">{profile.name}</h2>
                  <span className="chip text-[var(--color-good)]">parsed locally</span>
                </div>
                <p className="mono mt-1 text-[11px] text-[var(--color-mute-2)]">
                  {profileFile} · {profile.rawText.split('\n').length} lines
                </p>
              </div>
              <div className="flex gap-1">
                <button className={cx('btn btn-ghost', tab === 'profile' && 'text-[var(--color-fg)]')} onClick={() => setTab('profile')}>
                  Profile
                </button>
                <button className={cx('btn btn-ghost', tab === 'raw' && 'text-[var(--color-fg)]')} onClick={() => setTab('raw')}>
                  Raw text
                </button>
              </div>
            </div>

            {tab === 'profile' ? (
              <div className="mt-4 space-y-4">
                {aiSummary && (
                  <div className="rounded-xl border border-[var(--color-line)] bg-[var(--color-ink-2)] p-3">
                    <div className="mb-1 flex items-center gap-2 text-[10px] font-semibold tracking-wide text-[var(--color-pilot)]">
                      <span>◆</span> {engine.state === 'ready' ? 'SUMMARY BY THE LOCAL MODEL' : 'SUMMARY (NO MODEL LOADED)'}
                    </div>
                    <p className="text-sm leading-relaxed">{aiSummary}</p>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-3">
                  <Stat label="Years experience" value={String(profile.yearsExperience)} />
                  <Stat label="Skills recognised" value={String(profile.skills.length)} />
                  <Stat label="Roles parsed" value={String(profile.experience.length)} />
                </div>

                <Field label="Contact">
                  {[profile.email, profile.phone, profile.location].filter(Boolean).join(' · ') || 'Not found'}
                </Field>
                {profile.links.length > 0 && <Field label="Links">{profile.links.join(' · ')}</Field>}
                <Field label="Likely titles">{profile.titles.join(' · ')}</Field>
                {profile.summary && <Field label="Summary on file">{profile.summary.slice(0, 380)}</Field>}
                {profile.education.length > 0 && (
                  <Field label="Education">
                    {profile.education.map((e) => `${e.degree}${e.school ? `, ${e.school}` : ''}${e.year ? ` (${e.year})` : ''}`).join(' · ')}
                  </Field>
                )}
                <div>
                  <div className="mb-1.5 text-[10px] font-semibold tracking-wide text-[var(--color-mute-2)]">
                    SKILLS THE MATCHER CAN SEE
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {profile.skills.map((s) => (
                      <span key={s} className="chip">
                        {s}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <pre className="mono mt-4 max-h-[26rem] overflow-auto whitespace-pre-wrap rounded-xl border border-[var(--color-line)] bg-[var(--color-ink)] p-3 text-[11px] leading-relaxed text-[var(--color-mute)]">
                {profile.rawText}
              </pre>
            )}
          </div>

          <div className="panel p-5">
            <h2 className="text-lg font-semibold">Experience parsed</h2>
            <p className="mt-1 text-xs text-[var(--color-mute)]">
              What the pilot will quote back in cover letters and screening answers.
            </p>
            <div className="mt-4 space-y-3">
              {profile.experience.length ? (
                profile.experience.map((e, i) => (
                  <div key={i} className="rounded-xl border border-[var(--color-line)] bg-[var(--color-ink-2)] p-3">
                    <div className="flex items-baseline justify-between gap-2">
                      <div className="text-sm font-medium">{e.title}</div>
                      <div className="mono shrink-0 text-[10px] text-[var(--color-mute-2)]">{e.dates}</div>
                    </div>
                    {e.company && <div className="text-xs text-[var(--color-pilot)]">{e.company}</div>}
                    {e.bullets.length > 0 && (
                      <ul className="mt-2 space-y-1 text-[11px] leading-relaxed text-[var(--color-mute)]">
                        {e.bullets.map((b, j) => (
                          <li key={j} className="flex gap-1.5">
                            <span className="text-[var(--color-mute-2)]">–</span>
                            <span className="line-clamp-2">{b}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))
              ) : (
                <p className="text-xs text-[var(--color-mute-2)]">
                  No dated roles detected. The matcher falls back to your skills block, which still works.
                </p>
              )}
            </div>
            <button
              className="btn btn-ghost mt-4 w-full"
              disabled={runActive}
              title={runActive ? 'Stop the run before loading a different resume.' : undefined}
              onClick={() => {
                if (runActive) return;
                setProfile(null, null);
                setAiSummary('');
                setMatches([]);
                setWarnings([]);
              }}
            >
              Load a different resume
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[var(--color-line)] bg-[var(--color-ink-2)] p-3">
      <div className="text-lg font-semibold text-[var(--color-pilot)]">{value}</div>
      <div className="mt-0.5 text-[10px] tracking-wide text-[var(--color-mute-2)]">{label.toUpperCase()}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-[10px] font-semibold tracking-wide text-[var(--color-mute-2)]">{label.toUpperCase()}</div>
      <div className="text-xs leading-relaxed text-[var(--color-mute)]">{children}</div>
    </div>
  );
}
