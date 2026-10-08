import { useMemo, useState } from 'react';
import type { ResumeProfile } from '../types';
import { bookmarkletHref, consoleScript, downloadUserscript, payloadFromProfile, type FillPayload } from '../lib/formFill';
import { copyText } from '../lib/applyPack';
import { ai } from '../ai/instance';
import { enhanceFillSummary } from '../ai/tasks';
import { useStore } from '../store';

export default function FillHelper({ profile }: { profile: ResumeProfile }) {
  const [override, setOverride] = useState<Partial<FillPayload>>({});
  const [busy, setBusy] = useState(false);
  const engine = useStore((s) => s.engine);
  const base = useMemo(() => payloadFromProfile(profile), [profile]);
  const payload = useMemo(() => ({ ...base, ...override }), [base, override]);
  const href = useMemo(() => bookmarkletHref(payload), [payload]);
  const snippet = useMemo(() => consoleScript(payload), [payload]);
  const [copied, setCopied] = useState<'none' | 'mark' | 'js'>('none');

  const rows: [string, string][] = [
    ['First / last', `${payload.firstName} ${payload.lastName}`.trim()],
    ['Email', payload.email],
    ['Phone', payload.phone],
    ['City / state', [payload.city, payload.state, payload.country].filter(Boolean).join(', ')],
    ['LinkedIn', payload.linkedin],
    ['GitHub', payload.github],
    ['Website', payload.website],
    ['Title / company', [payload.currentTitle, payload.currentCompany].filter(Boolean).join(' · ')],
    ['School', [payload.degree, payload.school].filter(Boolean).join(', ')],
    ['Years', payload.years],
    ['Skills', payload.skills],
  ];

  return (
    <div className="panel mb-6 border-[var(--color-pilot-dim)] p-5">
      <h2 className="text-xl font-semibold tracking-tight">Populate application screens</h2>
      <p className="mt-2 max-w-3xl text-base leading-relaxed text-[var(--color-mute)]">
        This tab cannot type into another site. The fill script runs <em>on</em> the application
        page. It walks iframes and shadow DOM, sets React-controlled inputs the way the browser
        does, matches Greenhouse / Lever / Workday / Ashby / Indeed field names, and skips salary,
        work auth, EEO, passwords, and captchas. You still review and submit.
      </p>
      <ol className="mt-3 max-w-3xl list-decimal space-y-1 pl-6 text-base text-[var(--color-mute)]">
        <li>Show the bookmarks bar (Ctrl+Shift+B / Cmd+Shift+B).</li>
        <li>Drag <strong>JobPilot Fill</strong> onto the bar.</li>
        <li>Open the application form, click the bookmark, check the fields, submit.</li>
        <li>If the site blocks bookmarklets, copy the console script, press F12 → Console, paste, Enter.</li>
      </ol>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <a
          href={href}
          className="btn btn-primary text-base no-underline"
          onClick={(e) => e.preventDefault()}
          title="Drag this onto your bookmarks bar"
        >
          ☰ JobPilot Fill — drag to bookmarks
        </a>
        <button
          className="btn text-base"
          onClick={async () => {
            setCopied((await copyText(href)) ? 'mark' : 'none');
          }}
        >
          {copied === 'mark' ? 'Bookmarklet copied' : 'Copy bookmarklet'}
        </button>
        <button
          className="btn text-base"
          onClick={async () => {
            setCopied((await copyText(snippet)) ? 'js' : 'none');
          }}
        >
          {copied === 'js' ? 'Console script copied' : 'Copy console script'}
        </button>
        <button className="btn text-base" onClick={() => downloadUserscript(payload)}>
          Download Tampermonkey script
        </button>
        <button
          className="btn text-base"
          disabled={busy || engine.state !== 'ready'}
          title={engine.state === 'ready' ? 'Rewrite the summary with the on-device model' : 'Load a local model first'}
          onClick={async () => {
            setBusy(true);
            try {
              const summary = await enhanceFillSummary(ai.ready ? ai : null, profile, profile.titles[0]);
              if (summary) setOverride((o) => ({ ...o, summary }));
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? 'Drafting…' : 'AI: rewrite summary'}
        </button>
      </div>
      {payload.summary && (
        <p className="mt-3 text-base leading-relaxed text-[var(--color-mute)]">{payload.summary}</p>
      )}

      <dl className="mt-4 grid gap-2 sm:grid-cols-2 text-base">
        {rows.map(([k, v]) => (
          <button
            key={k}
            type="button"
            className="rounded-lg border border-[var(--color-line)] bg-[var(--color-ink-2)] px-3 py-2 text-left hover:border-[var(--color-line-2)]"
            onClick={() => v && copyText(v)}
            title="Click to copy"
          >
            <dt className="text-sm text-[var(--color-mute)]">{k}</dt>
            <dd className="truncate">{v || '—'}</dd>
          </button>
        ))}
      </dl>
    </div>
  );
}
