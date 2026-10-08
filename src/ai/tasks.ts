import type { Job, JobMatch, ResumeProfile } from '../types';
import type { LocalAI } from './engine';
import { parseLooseJSON } from './engine';

// ---------------------------------------------------------------------------
// Task layer: each function is "ask the local model, and if there is no model,
// do something sensible anyway". Every AI call is bounded, low-temperature, and
// asks for JSON we can repair.
// ---------------------------------------------------------------------------

export interface AnswerResult {
  answer: string;
  confidence: number;
  source: 'ai' | 'heuristic';
  reason?: string;
}

function skillsLine(profile: ResumeProfile) {
  return profile.skills.slice(0, 24).join(', ');
}

function profileBlock(profile: ResumeProfile) {
  const exp = profile.experience
    .slice(0, 3)
    .map((e) => `- ${e.title}${e.company ? ` @ ${e.company}` : ''} (${e.dates})`)
    .join('\n');
  return [
    `Name: ${profile.name}`,
    `Location: ${profile.location || 'unspecified'}`,
    `Years of experience: ${profile.yearsExperience}`,
    `Likely titles: ${profile.titles.join(', ')}`,
    `Skills: ${skillsLine(profile)}`,
    profile.summary ? `Summary: ${profile.summary.slice(0, 400)}` : '',
    exp ? `Experience:\n${exp}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

function jobBlock(job: Job) {
  return [
    `Title: ${job.title}`,
    `Company: ${job.company}`,
    `Location: ${job.location} (${job.remote})`,
    `Seniority: ${job.seniority}`,
    `Required: ${job.requiredSkills.join(', ')}`,
    `Nice to have: ${job.niceToHave.join(', ')}`,
    `About: ${job.description.slice(0, 500)}`,
  ].join('\n');
}

const SIGNOFF_WORDS =
  /^(sincerely|best regards|best|regards|kind regards|warm regards|with thanks|thank you|thanks|yours (?:truly|sincerely|faithfully))\b/i;

/**
 * Remove a closing sign-off and any signature name from the end of a letter.
 * Only a sign-off line followed by at most a few capitalised name words counts,
 * so "Best practices…" or "Thanks for your time." inside the body survive.
 */
export function stripSignOff(text: string): string {
  const lines = text.split('\n');
  for (let i = lines.length - 1; i >= Math.max(0, lines.length - 4); i--) {
    const m = lines[i].trim().match(SIGNOFF_WORDS);
    if (!m) continue;
    const rest = lines[i].trim().slice(m[0].length);
    if (/^[ ,.!]*(?:[A-Z][\w'.-]*\s*){0,4}$/.test(rest)) {
      return lines.slice(0, i).join('\n').trim();
    }
  }
  return text.trim();
}

/** 2–3 sentence cover letter. Falls back to a template built from the profile. */
export async function draftCoverLetter(
  ai: LocalAI | null,
  profile: ResumeProfile,
  job: Job,
  matched: string[],
): Promise<string> {
  const fallback = () => {
    const top = matched.slice(0, 3).join(', ') || profile.skills.slice(0, 3).join(', ');
    return [
      `I am applying for the ${job.title} role at ${job.company}.`,
      `My background is in ${profile.titles[0]?.toLowerCase() ?? 'software engineering'} with ${profile.yearsExperience} years of professional experience, and the work I have shipped lines up closely with what this posting asks for — particularly ${top}.`,
      `I would welcome the chance to talk about how that experience maps onto your team's roadmap.`,
    ].join(' ');
  };
  if (!ai?.ready) return fallback();
  try {
    const text = await ai.complete(
      [
        {
          role: 'system',
          content:
            'You write short, specific cover letters. Never invent employers, degrees, certifications, or metrics that are not in the candidate brief. Write in first person, plain professional English. 55-90 words. Output the letter only — no greeting, no sign-off, no markdown.',
        },
        {
          role: 'user',
          content: `CANDIDATE BRIEF\n${profileBlock(profile)}\n\nROLE\n${jobBlock(job)}\n\nWrite the body of a cover letter for this role.`,
        },
      ],
      { maxTokens: 260, temperature: 0.5 },
    );
    const cleaned = stripSignOff(text.replace(/^(cover letter|dear[^\n]*)\s*:?\s*/i, '').trim());
    if (cleaned.length > 60) return cleaned;
    return fallback();
  } catch {
    return fallback();
  }
}

/**
 * Topics a language model must never answer unattended. Shared by the pilot and
 * by answerQuestion, and checked before any heuristic so a broad keyword can
 * never answer one of these for the candidate.
 */
export const SENSITIVE_TOPICS: { id: string; label: string; re: RegExp; reason: string }[] = [
  {
    id: 'work-authorisation',
    label: 'work authorisation',
    re: /\b(work authori[sz]ation|authori[sz]ed to work|legally (?:authori[sz]ed|eligible|permitted)|right to work|eligible to work|work permits?|work visas?|visa|visa sponsorship|sponsorship|sponsor)\b/i,
    reason: 'Work authorisation is a legal declaration. JobPilot never answers this for you — it must come from you.',
  },
  {
    id: 'compensation',
    label: 'compensation expectations',
    re: /\b(salary|salaries|compensation|remuneration|wages?|ctc|pay (?:expectations?|rate|range|requirements?)|expected pay|desired pay|hourly rate|day rate|rate expectations?|expected rate)\b/i,
    reason: 'Compensation expectations are a negotiating position, not a fact on the resume. Your call.',
  },
  {
    id: 'availability',
    label: 'notice period and availability',
    re: /\b(notice period|start date|available to start|earliest start|when can you start|availability)\b/i,
    reason: 'Only you know your actual availability. The pilot will not invent a start date.',
  },
  {
    id: 'credentials',
    label: 'credentials and clearances',
    re: /\b(clearance|security clearance|certifications?|certified|licen[cs]es?|credentials?)\b/i,
    reason: 'Credentials must be asserted by the candidate, not inferred.',
  },
  {
    id: 'eeo',
    label: 'equal-opportunity and self-identification questions',
    re: /\b(gender|race|ethnicity|ethnic|veterans?|disability|disabilities|disabled|sexual orientation|pronouns?|religion|religious|demographics?|equal opportunity|eeo)\b/i,
    reason: 'Equal-opportunity and self-identification questions are voluntary and personal. Only you answer them.',
  },
  {
    id: 'background',
    label: 'criminal-record and background questions',
    re: /\b(criminal|convicted|convictions?|felony|felonies|arrests?|background checks?|pending charges)\b/i,
    reason: 'Criminal-record and background questions are personal legal disclosures. Only you answer them.',
  },
];

/** The sensitive topic a question touches, if any. */
export function sensitiveTopic(question: string) {
  return SENSITIVE_TOPICS.find((t) => t.re.test(question)) ?? null;
}

/** Answer one application question. Low confidence ⇒ the human gets asked. */
export async function answerQuestion(
  ai: LocalAI | null,
  profile: ResumeProfile,
  job: Job,
  question: string,
): Promise<AnswerResult> {
  // Sensitive topics come first: no heuristic or model may answer them.
  const sensitive = sensitiveTopic(question);
  if (sensitive) {
    return {
      answer: '__NEEDS_HUMAN__',
      confidence: sensitive.id === 'availability' ? 0.3 : 0.2,
      source: 'heuristic',
      reason: sensitive.reason,
    };
  }

  const q = question.toLowerCase();

  // Facts that can be read straight off the resume.
  if (/\b(e-?mail)\b/.test(q) && profile.email)
    return { answer: profile.email, confidence: 0.99, source: 'heuristic' };
  if (/\b(phone|mobile|contact number)\b/.test(q) && profile.phone)
    return { answer: profile.phone, confidence: 0.99, source: 'heuristic' };
  if (/\b(full name|your name)\b/.test(q))
    return { answer: profile.name, confidence: 0.98, source: 'heuristic' };
  if (/\b(city|location|where are you based|time ?zone)\b/.test(q) && profile.location)
    return { answer: profile.location, confidence: 0.9, source: 'heuristic' };
  if (/\b(years? of|how many years)\b/.test(q) && /\bexperience\b/.test(q))
    return {
      answer: String(profile.yearsExperience),
      confidence: 0.85,
      source: 'heuristic',
      reason: 'summed from dated roles on the resume',
    };

  if (!ai?.ready) {
    return {
      answer: '__NEEDS_HUMAN__',
      confidence: 0.3,
      source: 'heuristic',
      reason: 'No local model loaded, so this question is left for you rather than guessed.',
    };
  }

  try {
    const out = await ai.completeJSON<{ answer: string; confidence: number; basis?: string }>(
      [
        {
          role: 'system',
          content: [
            'You help a candidate fill in a job application. You answer ONLY from the candidate brief.',
            'Rules: never invent employers, dates, degrees, certifications, clearance, visa status, or salary numbers.',
            'If the brief does not support a factual answer, or the question is about compensation, availability, work authorisation, or credentials, reply with the single token NEEDS_HUMAN for the answer and confidence 0.',
            'Keep answers under 45 words. Use natural first-person voice.',
            'Respond with JSON only, shaped exactly like: {"answer":"...","confidence":0.0,"basis":"short reason"}',
          ].join('\n'),
        },
        {
          role: 'user',
          content: `CANDIDATE BRIEF\n${profileBlock(profile)}\n\nROLE\n${jobBlock(job)}\n\nQUESTION\n${question}\n\nJSON:`,
        },
      ],
      { maxTokens: 200, temperature: 0.1 },
    );
    if (out && typeof out.answer === 'string' && out.answer.trim()) {
      const answer = out.answer.trim();
      let confidence = Number(out.confidence);
      if (!Number.isFinite(confidence)) confidence = 0.6;
      confidence = Math.max(0, Math.min(1, confidence));
      if (/needs_human/i.test(answer) || confidence < 0.55) {
        return {
          answer: 'Human review',
          confidence: 0.2,
          source: 'ai',
          reason: out.basis?.trim() || 'The local model judged this too sensitive to answer unattended.',
        };
      }
      return { answer, confidence, source: 'ai', reason: out.basis?.trim() };
    }
  } catch {
    /* fall through */
  }
  return {
    answer: 'Human review',
    confidence: 0.3,
    source: 'ai',
    reason: 'The local model returned nothing usable, so the question is yours.',
  };
}

/** Second opinion on a heuristic score + a human-readable rationale. */
export async function refineMatch(
  ai: LocalAI | null,
  profile: ResumeProfile,
  job: Job,
  heuristic: JobMatch,
): Promise<JobMatch> {
  if (!ai?.ready) return heuristic;
  try {
    const out = await ai.completeJSON<{ score: number; rationale: string; missing?: string[] }>(
      [
        {
          role: 'system',
          content:
            'You are a blunt technical recruiter. Given a candidate brief and a job posting, give a fit score 0-100 and a two-sentence rationale that names concrete evidence from the brief. Do not be flattering. JSON only: {"score":0,"rationale":"...","missing":["..."]}',
        },
        {
          role: 'user',
          content: `CANDIDATE BRIEF\n${profileBlock(profile)}\n\nJOB\n${jobBlock(job)}\n\nJSON:`,
        },
      ],
      { maxTokens: 220, temperature: 0.2 },
    );
    if (!out || typeof out.score !== 'number') return heuristic;
    // A knockout (hard requirement missing) keeps the heuristic's capped score.
    // Everywhere else the model's view is blended in, whatever the verdict.
    const blended = Math.round(out.score * 0.45 + heuristic.score * 0.55);
    const score = heuristic.knockout ? heuristic.score : blended;
    return {
      ...heuristic,
      score: Math.max(3, Math.min(99, score)),
      rationale: out.rationale?.trim() ? `${out.rationale.trim()} (Pilot score ${Math.round(out.score)} blended with evidence score ${heuristic.score}.)` : heuristic.rationale,
      missingSkills: Array.isArray(out.missing) && out.missing.length ? out.missing.slice(0, 6).map(String) : heuristic.missingSkills,
      source: 'ai',
    };
  } catch {
    return heuristic;
  }
}

/** One-line "who is this person" summary shown on the dashboard. */
export async function summarizeProfile(ai: LocalAI | null, profile: ResumeProfile): Promise<string> {
  const fallback = `${profile.titles[0] ?? 'Candidate'} with ${profile.yearsExperience} years of experience across ${profile.skills.slice(0, 4).join(', ') || 'a broad toolkit'}.`;
  if (!ai?.ready) return fallback;
  try {
    const text = await ai.complete(
      [
        {
          role: 'system',
          content:
            'Summarise the candidate in exactly one sentence, under 30 words, third person, no clichés like "passionate" or "results-driven". Facts from the brief only.',
        },
        { role: 'user', content: profileBlock(profile) },
      ],
      { maxTokens: 90, temperature: 0.3 },
    );
    const one = text.split(/\n/)[0].trim();
    return one.length > 20 ? one : fallback;
  } catch {
    return fallback;
  }
}

const FILL_KEY_LIST =
  'firstName,middleName,lastName,fullName,email,phone,location,city,state,postal,country,street,linkedin,github,website,twitter,years,headline,currentTitle,currentCompany,school,degree,skills,summary,skip';

/** Map free-text application labels onto fill keys. Sensitive labels become skip. */
export async function classifyFieldLabels(
  ai: LocalAI | null,
  labels: string[],
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const label of labels) {
    if (sensitiveTopic(label)) out[label] = 'skip';
  }
  const unknown = labels.filter((l) => !out[l]);
  if (!unknown.length || !ai?.ready) return out;
  try {
    const json = await ai.completeJSON<Record<string, string>>(
      [
        {
          role: 'system',
          content: `You map job-application field labels to one of: ${FILL_KEY_LIST}. Use skip when the field is login, password, salary, visa, EEO, or not answerable from a resume. JSON object only, keys = the labels exactly.`,
        },
        { role: 'user', content: unknown.slice(0, 24).map((l, i) => `${i + 1}. ${l}`).join('\n') },
      ],
      { maxTokens: 400, temperature: 0.1 },
    );
    if (json && typeof json === 'object') {
      for (const [k, v] of Object.entries(json)) {
        if (typeof v === 'string') out[k] = v;
      }
    }
  } catch {
    /* keep heuristic-only map */
  }
  return out;
}

/** Tighten the cover/summary on the fill payload using the local model. */
export async function enhanceFillSummary(
  ai: LocalAI | null,
  profile: ResumeProfile,
  jobTitle?: string,
): Promise<string> {
  const fallback = (profile.summary || '').replace(/\s+/g, ' ').trim();
  if (!ai?.ready) return fallback;
  try {
    const text = await ai.complete(
      [
        {
          role: 'system',
          content:
            'Write a 60-90 word first-person application summary from the brief only. No invented employers, metrics, or degrees. No greeting or sign-off.',
        },
        {
          role: 'user',
          content: `${profileBlock(profile)}${jobTitle ? `\nTarget role: ${jobTitle}` : ''}\nWrite the summary.`,
        },
      ],
      { maxTokens: 220, temperature: 0.4 },
    );
    const cleaned = stripSignOff(text.trim());
    return cleaned.length > 40 ? cleaned : fallback;
  } catch {
    return fallback;
  }
}

/** Human ✓ / ✎ / ✕ decision on a drafted answer; the model never learns from it, it just gets applied. */
export function applyHumanDecision(task: { suggestion?: string }, decision: 'accept' | string) {
  if (decision === 'accept') return task.suggestion ?? '';
  return decision;
}
