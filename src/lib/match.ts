import type { Job, JobMatch, ResumeProfile } from '../types';
import { detectSkills, jobSkillKeys, profileSkillKeys } from './resume';

// ---------------------------------------------------------------------------
// Deterministic matching. Runs with zero AI available — the LLM only ever
// *refines* these numbers, never computes them from scratch. That keeps the
// ranking stable and explainable.
// ---------------------------------------------------------------------------

const SENIORITY_RANK = { junior: 1, mid: 2, senior: 3, staff: 4 } as const;

export interface ScoreOptions {
  /** Restrict to jobs posted within N days (0 = no limit). */
  maxAgeDays?: number;
  /** Minimum score to be considered a match. */
  threshold?: number;
  /** Jobs the candidate must be able to work remotely. */
  remoteOnly?: boolean;
}

export function scoreJob(profile: ResumeProfile, job: Job): JobMatch {
  const have = profileSkillKeys(profile);
  const requiredKeys = new Set(job.requiredSkills.flatMap(jobSkillKeys));
  const niceKeys = new Set(job.niceToHave.flatMap(jobSkillKeys));

  const matchedRequired: string[] = [];
  const matchedNice: string[] = [];
  for (const skill of job.requiredSkills) {
    const keys = jobSkillKeys(skill);
    if (keys.some((k) => have.has(k))) matchedRequired.push(skill);
  }
  for (const skill of job.niceToHave) {
    const keys = jobSkillKeys(skill);
    if (keys.some((k) => have.has(k))) matchedNice.push(skill);
  }

  const missingRequired = job.requiredSkills.filter((s) => !matchedRequired.includes(s));
  const requiredCoverage = job.requiredSkills.length
    ? matchedRequired.length / job.requiredSkills.length
    : 1;
  const niceCoverage = job.niceToHave.length ? matchedNice.length / job.niceToHave.length : 0;

  // Title alignment: does any of the candidate's inferred titles overlap the
  // posting's words?
  const titleWords = (t: string) =>
    new Set(t.toLowerCase().split(/[^a-z+#]+/).filter((w) => w.length > 2));
  const jobWords = titleWords(job.title);
  let titleOverlap = 0;
  for (const t of profile.titles) {
    const cand = titleWords(t);
    const shared = [...jobWords].filter((w) => cand.has(w)).length;
    titleOverlap = Math.max(titleOverlap, shared / Math.max(jobWords.size, 1));
  }

  // Seniority fit: penalise applying two levels below the posting.
  const jr = SENIORITY_RANK[job.seniority];
  const cr =
    profile.yearsExperience >= 9
      ? 4
      : profile.yearsExperience >= 6
        ? 3
        : profile.yearsExperience >= 3
          ? 2
          : 1;
  const seniorityFit = 1 - Math.min(Math.abs(jr - cr), 2) / 2;

  // Recency: fresh postings get a nudge, ancient ones a nudge down.
  const recency = Math.max(0, 1 - job.postedDaysAgo / 30);

  // Posting description wash: does the candidate's summary echo the language
  // of the posting? (cheap proxy for "this is the same field")
  const descKeys = new Set(detectSkills(job.description));
  for (const k of have) descKeys.delete(k);
  const fieldEcho = 1 - Math.min(descKeys.size / 8, 1);

  const score =
    requiredCoverage * 62 +
    niceCoverage * 13 +
    titleOverlap * 12 +
    seniorityFit * 8 +
    recency * 5 +
    fieldEcho * 0;

  const pct = Math.max(3, Math.min(99, Math.round(score)));

  // Hard knockouts: the fictional ATS rejects resumes that cannot claim the
  // explicit requirement, no matter how good the rest is.
  const knockoutHit = (job.knockout ?? []).some((k) => {
    const keys = jobSkillKeys(k);
    return !keys.some((key) => have.has(key)) && !new RegExp(k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(profile.rawText);
  });

  const verdict: JobMatch['verdict'] = knockoutHit
    ? 'stretch'
    : pct >= 78
      ? 'strong'
      : pct >= 55
        ? 'good'
        : 'stretch';

  const rationale = knockoutHit
    ? `Posting carries a hard requirement this resume does not evidence (${(job.knockout ?? []).join(', ')}). The ATS will knock this out on parse, so JobPilot will report it rather than submit a doomed application.`
    : `${matchedRequired.length}/${job.requiredSkills.length} required skills evidenced${
        missingRequired.length ? ` (missing: ${missingRequired.slice(0, 3).join(', ')})` : ''
      }, ${matchedNice.length} nice-to-haves, title overlap ${(titleOverlap * 100).toFixed(0)}%, seniority fit ${(seniorityFit * 100).toFixed(0)}%.`;

  return {
    jobId: job.id,
    score: knockoutHit ? Math.min(pct, 32) : pct,
    verdict,
    matchedSkills: [...matchedRequired, ...matchedNice],
    missingSkills: missingRequired,
    rationale,
    source: 'heuristic',
  };
}

export function rankJobs(
  profile: ResumeProfile,
  jobs: Job[],
  opts: ScoreOptions = {},
): JobMatch[] {
  const { maxAgeDays = 0, threshold = 0, remoteOnly = false } = opts;
  return jobs
    .filter((j) => (maxAgeDays ? j.postedDaysAgo <= maxAgeDays : true))
    .filter((j) => (remoteOnly ? j.remote !== 'onsite' : true))
    .map((j) => scoreJob(profile, j))
    .filter((m) => m.score >= threshold)
    .sort((a, b) => b.score - a.score);
}

// ---------------------------------------------------------------------------
// Fabricated application-form field extraction.
//
// In a real product this is where you would plug in a real ATS integration.
// Here we derive the fields the *fictional* portal asks for, so the human can
// watch them get filled in one at a time.
// ---------------------------------------------------------------------------

export interface FormField {
  id: string;
  label: string;
  kind: 'text' | 'email' | 'tel' | 'url' | 'textarea' | 'number' | 'select';
  options?: string[];
  /** Cheap deterministic prefill where one is unambiguous. */
  prefill?: string;
  required: boolean;
}

const STANDARD_FIELDS: FormField[] = [
  { id: 'full_name', label: 'Full name', kind: 'text', required: true },
  { id: 'email', label: 'Email address', kind: 'email', required: true },
  { id: 'phone', label: 'Phone number', kind: 'tel', required: true },
  { id: 'location', label: 'City and country', kind: 'text', required: true },
  { id: 'links', label: 'Portfolio / GitHub / LinkedIn', kind: 'url', required: false },
  {
    id: 'work_auth',
    label: 'Are you legally authorised to work in the country of this posting?',
    kind: 'select',
    options: ['Yes', 'No', 'Requires sponsorship'],
    required: true,
  },
  {
    id: 'years_exp',
    label: 'Total years of relevant professional experience',
    kind: 'number',
    required: true,
  },
  {
    id: 'notice',
    label: 'Notice period / earliest start date',
    kind: 'text',
    required: true,
  },
  {
    id: 'salary',
    label: 'Salary expectation (annual, local currency)',
    kind: 'text',
    required: false,
  },
  {
    id: 'resume_file',
    label: 'Attach resume (PDF)',
    kind: 'text',
    required: true,
  },
  {
    id: 'cover_letter',
    label: 'Cover letter — why this role, why you?',
    kind: 'textarea',
    required: true,
  },
];

export function formFieldsFor(job: Job): FormField[] {
  // Some postings add one extra screening question on top of the standard set.
  const extra: FormField[] = job.questions.slice(0, 1).map((q, i) => ({
    id: `screening_${i}`,
    label: q,
    kind: q.length > 90 ? 'textarea' : 'text',
    required: true,
  }));
  return [...STANDARD_FIELDS, ...extra];
}
