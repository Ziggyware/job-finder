import { useCallback, useRef, useState } from 'react';
import { extractResumeText } from '../lib/extractText';
import { profileResume } from '../lib/resume';
import { useStore } from '../store';
import { ai } from '../ai/instance';
import { summarizeProfile } from '../ai/tasks';
import { cx } from '../lib/util';

export default function ResumeStage({ onContinue }: { onContinue?: () => void }) {
  const profile = useStore((s) => s.profile);
  const profileFile = useStore((s) => s.profileFile);
  const aiSummary = useStore((s) => s.aiSummary);
  const busy = useStore((s) => s.busyExtracting);
  const setProfile = useStore((s) => s.setProfile);
  const setBusy = useStore((s) => s.setBusyExtracting);
  const setAiSummary = useStore((s) => s.setAiSummary);
  const log = useStore((s) => s.log);
  const engine = useStore((s) => s.engine);

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
      log(
        'info',
        `Resume ingested on this device: ${filename} → ${parsed.skills.length} skills recognised, ${parsed.yearsExperience} years of experience inferred.`,
      );
      if (ai.ready) {
        log('ai', 'Local model produced a candidate summary without any network call.');
      } else {
        log(
          'warn',
          'No local model loaded — cover letters use a template until you load a model.',
        );
      }
      // The summary is the only slow part, and it is cosmetic: it arrives last and only if still current.
      const summary = await summarizeProfile(ai.ready ? ai : null, parsed);
      if (current()) setAiSummary(summary);
    },
    [ai, log, setAiSummary, setProfile],
  );

  const onFiles = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
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
    [ingest, setBusy],
  );

  return (
    <div className="mx-auto max-w-5xl px-5 py-8">
      <div className="mb-6">
        <h1 className="text-3xl font-semibold tracking-tight">Start with your resume</h1>
        <p className="mt-2 max-w-2xl text-base leading-relaxed text-[var(--color-mute)]">
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
            <div className="text-lg font-medium">
              {busy ? 'Parsing on this device…' : 'Drop your resume here, or click to choose'}
            </div>
            <div className="mt-1.5 text-base text-[var(--color-mute-2)]">
              PDF · DOCX · TXT · MD · RTF — parsed locally, never uploaded
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button className="btn" onClick={() => setPasteOpen((v) => !v)}>
              ✎ Paste resume text instead
            </button>
          </div>

          {pasteOpen && (
            <div className="panel mt-4 p-4">
              <textarea
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                placeholder="Paste the full text of your resume…"
                className="h-56 w-full resize-y rounded-xl border border-[var(--color-line)] bg-[var(--color-ink)] p-3 text-base leading-relaxed outline-none focus:border-[var(--color-line-2)]"
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
                <p className="mt-1 text-sm text-[var(--color-mute-2)]">
                  {profileFile} · {profile.rawText.split('\n').length} lines · saved in this browser
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
                    <div className="mb-1 flex items-center gap-2 text-sm font-semibold tracking-wide text-[var(--color-pilot)]">
                      <span>◆</span> {engine.state === 'ready' ? 'Summary (local model)' : 'Summary'}
                    </div>
                    <p className="text-base leading-relaxed">{aiSummary}</p>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3 text-base sm:grid-cols-3">
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
                  <div className="mb-1.5 text-sm font-semibold tracking-wide text-[var(--color-mute-2)]">
                    Skills
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
              <pre className="mt-4 max-h-[26rem] overflow-auto whitespace-pre-wrap rounded-xl border border-[var(--color-line)] bg-[var(--color-ink)] p-3 text-base leading-relaxed text-[var(--color-mute)]">
                {profile.rawText}
              </pre>
            )}
          </div>

          <div className="panel p-5">
            <h2 className="text-lg font-semibold">Experience parsed</h2>
            <p className="mt-1 text-base text-[var(--color-mute)]">
              Used in cover letters and the fill script.
            </p>
            <div className="mt-4 space-y-3">
              {profile.experience.length ? (
                profile.experience.map((e, i) => (
                  <div key={i} className="rounded-xl border border-[var(--color-line)] bg-[var(--color-ink-2)] p-3">
                    <div className="flex items-baseline justify-between gap-2">
                      <div className="text-base font-medium">{e.title}</div>
                      <div className="shrink-0 text-sm text-[var(--color-mute-2)]">{e.dates}</div>
                    </div>
                    {e.company && <div className="text-base text-[var(--color-pilot)]">{e.company}</div>}
                    {e.bullets.length > 0 && (
                      <ul className="mt-2 space-y-1 text-base leading-relaxed text-[var(--color-mute)]">
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
                <p className="text-base text-[var(--color-mute-2)]">
                  No dated roles detected. Skills and contact still fill applications.
                </p>
              )}
            </div>
            {onContinue && (
              <button className="btn btn-primary mt-4 w-full text-base" onClick={onContinue}>
                Continue to search & apply
              </button>
            )}
            <button
              className="btn btn-ghost mt-2 w-full"
              onClick={() => {
                setProfile(null, null);
                setAiSummary('');
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
      <div className="mt-0.5 text-sm tracking-wide text-[var(--color-mute-2)]">{label}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-sm font-semibold tracking-wide text-[var(--color-mute-2)]">{label}</div>
      <div className="text-base leading-relaxed text-[var(--color-mute)]">{children}</div>
    </div>
  );
}
