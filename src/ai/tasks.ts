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
    const cleaned = text.replace(/^(cover letter|dear[^\n]*)\s*:?\s*/i, '').replace(/^(sincerely|best|regards)[\s\S]*$/i, '').trim();
    if (cleaned.length > 60) return cleaned;
    return fallback();
  } catch {
    return fallback();
  }
}

/** Answer one application question. Low confidence ⇒ the human gets asked. */
export async function answerQuestion(
  ai: LocalAI | null,
  profile: ResumeProfile,
  job: Job,
  question: string,
): Promise<AnswerResult> {
  const q = question.toLowerCase();

  // Facts that must never be guessed by a language model.
  if (/(e-?mail)/.test(q) && profile.email)
    return { answer: profile.email, confidence: 0.99, source: 'heuristic' };
  if (/(phone|mobile|contact number)/.test(q) && profile.phone)
    return { answer: profile.phone, confidence: 0.99, source: 'heuristic' };
  if (/(full name|your name)/.test(q))
    return { answer: profile.name, confidence: 0.98, source: 'heuristic' };
  if (/(city|location|where are you based|time ?zone)/.test(q) && profile.location)
    return { answer: profile.location, confidence: 0.9, source: 'heuristic' };
  if (/(years? of|how many years)/.test(q) && /experience/.test(q))
    return {
      answer: String(profile.yearsExperience),
      confidence: 0.85,
      source: 'heuristic',
      reason: 'summed from dated roles on the resume',
    };
  if (/(authoris|authoriz|legally.*work|work.*permit|visa|sponsor)/.test(q))
    return {
      answer: '__NEEDS_HUMAN__',
      confidence: 0.2,
      source: 'heuristic',
      reason:
        'Work authorisation is a legal declaration. JobPilot never answers this for you — it must come from you.',
    };
  if (/(salary|compensation|rate|expect)/.test(q))
    return {
      answer: '__NEEDS_HUMAN__',
      confidence: 0.25,
      source: 'heuristic',
      reason:
        'Compensation expectations are a negotiating position, not a fact on the resume. Your call.',
    };
  if (/(notice period|start date|available to start)/.test(q))
    return {
      answer: '__NEEDS_HUMAN__',
      confidence: 0.3,
      source: 'heuristic',
      reason: 'Only you know your actual availability. The pilot will not invent a start date.',
    };
  if (/(clearance|certification|certified|licen[cs]e|security clear)/.test(q))
    return {
      answer: '__NEEDS_HUMAN__',
      confidence: 0.15,
      source: 'heuristic',
      reason: 'Credentials must be asserted by the candidate, not inferred.',
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
      if (/(salary|compensation|sponsor|clearance|visa|authoris|authoriz)/i.test(question)) {
        // Belt and braces: even a confident model answer on these gets a human.
        return {
          answer,
          confidence: Math.min(confidence, 0.45),
          source: 'ai',
          reason: 'Sensitive topic — drafted by the pilot, but you confirm it.',
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
    const blended = Math.round(out.score * 0.45 + heuristic.score * 0.55);
    return {
      ...heuristic,
      score: Math.max(3, Math.min(99, heuristic.verdict === 'stretch' && heuristic.score < 35 ? heuristic.score : blended)),
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

/** Human ✓ / ✎ / ✕ decision on a drafted answer; the model never learns from it, it just gets applied. */
export function applyHumanDecision(task: { suggestion?: string }, decision: 'accept' | string) {
  if (decision === 'accept') return task.suggestion ?? '';
  return decision;
}
