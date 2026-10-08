import type { PendingTask } from '../types';

// ---------------------------------------------------------------------------
// The "are you human" checks.
//
// These are drawn from the shapes real anti-bot walls use. The important design
// decision is the `solvableBy` field, which is honest about who actually does
// the work:
//
//   'agent' — a plain checkbox/stall. The agent clicks it, no human needed.
//   'ai'    — a text/logic challenge. The local LLM can genuinely answer this
//             ("name the object with two wheels and an engine") because it is
//             language, not image recognition.
//   'human' — visual challenge: distorted glyphs, image grids, drag puzzles.
//             A text LLM in a browser tab cannot see. Pretending otherwise
//             would be a lie and would produce silent CAPTCHA failures. So the
//             agent pauses, tells you, and waits.
// ---------------------------------------------------------------------------

export type ChallengeKind = 'checkbox' | 'text-image' | 'select-image' | 'slider' | 'question';

export interface Challenge {
  kind: ChallengeKind;
  prompt: string;
  solvableBy: 'agent' | 'ai' | 'human';
  /** For 'ai' challenges: the expected token (the portal knows the answer). Never shown to the operator. */
  answer?: string;
  /** Why this one is in front of the human, when that is not the default visual-wall reason. */
  reason?: string;
  /** For 'human' challenges: validation is done in the UI against this. */
  humanAnswer?: string;
  /** Image tiles for select-image: each is a label the renderer draws. */
  tiles?: { glyph: string; label: string; correct: boolean }[];
}

const TEXT_CAPTCHAS = [
  'hnR4wq',
  'PD7k2m',
  'Xb3T9z',
  'vQ8sLd',
  'Kj5Rf1',
];

const AI_CHALLENGES: Challenge[] = [
  {
    kind: 'question',
    solvableBy: 'ai',
    prompt: 'Human check: type the word for the vehicle that has two wheels and an engine.',
    answer: 'motorcycle',
  },
  {
    kind: 'question',
    solvableBy: 'ai',
    prompt: 'Human check: type the number that comes after 8 in the sequence 2, 4, 6, 8, ?',
    answer: '10',
  },
  {
    kind: 'question',
    solvableBy: 'ai',
    prompt: 'Human check: type the colour you get by mixing blue and yellow.',
    answer: 'green',
  },
];

const HUMAN_ANSWERABLE: Challenge = {
  kind: 'select-image',
  solvableBy: 'human',
  prompt: 'Select every tile that shows a crosswalk.',
  answer: undefined,
  tiles: [
    { glyph: '🏍️', label: 'motorcycle', correct: false },
    { glyph: '🚸', label: 'crosswalk', correct: true },
    { glyph: '🌁', label: 'bridge', correct: false },
    { glyph: '🚧', label: 'barrier', correct: false },
    { glyph: '🦓', label: 'zebra crossing', correct: true },
    { glyph: '🚥', label: 'traffic light', correct: false },
    { glyph: '🚦', label: 'crosswalk sign', correct: true },
    { glyph: '🛑', label: 'stopsign', correct: false },
    { glyph: '🚏', label: 'bus stop', correct: false },
  ],
};

let counter = 0;

/** Stable, well-mixed hash of an id, so each application draws its own challenges. */
function hashId(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Produce the next challenge the fictional portal throws up. */
export function nextChallenge(applicationId: string, ordinal: number): Challenge {
  const pick = <T,>(arr: T[], seed: number) => arr[seed % arr.length];
  const h = hashId(applicationId);

  if (ordinal === 0) {
    return {
      kind: 'checkbox',
      solvableBy: 'agent',
      prompt: "Verify you are human: I'm not a robot.",
    };
  }
  // Second wall is usually a text CAPTCHA.
  if (ordinal === 1) {
    const code = pick(TEXT_CAPTCHAS, h + ordinal);
    return {
      kind: 'text-image',
      solvableBy: 'human',
      prompt: `Type the ${code.length} characters shown in the distorted image (case-sensitive).`,
      humanAnswer: code,
    };
  }
  // Then a text-reasoning challenge the local model can actually solve.
  if (ordinal === 2) {
    return { ...pick(AI_CHALLENGES, h + ordinal) };
  }
  // Then something purely visual.
  if (ordinal === 3) return { ...HUMAN_ANSWERABLE };

  // Then a drag puzzle.
  return {
    kind: 'slider',
    solvableBy: 'human',
    prompt: 'Slide the puzzle piece into the gap to continue.',
  };
}

export function makePendingChallenge(
  applicationId: string,
  jobId: string,
  jobTitle: string,
  company: string,
  stepId: string,
  challenge: Challenge,
): PendingTask {
  return {
    id: `hc-${Date.now().toString(36)}-${counter++}`,
    applicationId,
    jobId,
    jobTitle,
    company,
    kind: challenge.kind === 'question' ? 'question' : 'human-check',
    stepId,
    challenge: challenge.kind === 'question' ? undefined : challenge.kind,
    challengePrompt: challenge.prompt,
    question: challenge.kind === 'question' ? challenge.prompt : undefined,
    expected: challenge.humanAnswer,
    tiles: challenge.tiles,
    // The portal's own expected answer (challenge.answer) is deliberately NOT
    // surfaced as a draft: the operator should not be handed the key to a check.
    reason:
      challenge.reason ??
      (challenge.solvableBy === 'human' && challenge.kind !== 'question'
        ? 'Visual anti-bot wall. A text-only model running in your tab cannot see images, so JobPilot stops and asks you rather than firing blind guesses at your account.'
        : undefined),
    createdAt: Date.now(),
  };
}

/**
 * Ask the local model for the answer to an 'ai' challenge. Returns the raw reply;
 * judging it is `answerMatches`' job, so a model reply is never trusted blindly.
 */
export async function solveChallengeWithAI(
  ask: (prompt: string) => Promise<string>,
  challenge: Challenge,
): Promise<{ answer: string; confidence: number } | null> {
  if (challenge.solvableBy !== 'ai') return null;
  try {
    const reply = await ask(
      `Answer this anti-bot verification question with only the exact word or number, nothing else: "${challenge.prompt}"`,
    );
    const answer = reply.trim();
    if (!answer) return null;
    return { answer, confidence: 0.75 };
  } catch {
    return null;
  }
}

const normaliseAnswer = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Does a model reply equal the expected answer? Exact after normalising case,
 * punctuation and a leading filler ("The answer is", "a"). Substring tests are
 * not acceptable here: "1" is not "10", "e" is not "motorcycle", and an empty
 * expectation matches nothing.
 */
export function answerMatches(reply: string, expected: string): boolean {
  const want = normaliseAnswer(expected);
  if (!want) return false;
  const got = normaliseAnswer(reply)
    .replace(/^(the answer is|answer is|answer|it is|it s)\s+/, '')
    .replace(/^(a|an|the)\s+/, '');
  return got === want;
}
