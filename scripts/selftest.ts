/* eslint-disable no-console */
// Headless self-test. Runs the real parser, matcher, and pilot state machine in
// Node with no browser — the fastest way to know the agent's logic is sound.
//
//   node_modules/.bin/jiti scripts/selftest.ts

import { profileResume, detectSkills } from '../src/lib/resume';
import { rankJobs, scoreJob, formFieldsFor } from '../src/lib/match';
import { parseLooseJSON } from '../src/ai/engine';
import { JOBS } from '../src/data/jobs';
import { useStore } from '../src/store';
import { pilot } from '../src/agent/pilot';
import { answerMatches, makePendingChallenge, nextChallenge } from '../src/ai/humanCheck';
import { answerQuestion, refineMatch, sensitiveTopic, stripSignOff } from '../src/ai/tasks';
import { docxToText } from '../src/lib/docx';

const SAMPLE = `DANA OKAFOR
San Francisco, CA · dana.okafor@example.com · +1 415 555 0142
github.com/danaokafor · linkedin.com/in/danaokafor

SUMMARY
Frontend-leaning full stack engineer with 8+ years of experience building
collaborative web applications.

EXPERIENCE
Senior Frontend Engineer — Loomline (2021 - Present)
- Rebuilt the canvas renderer in WebGL, lifting median frame rate from 34 to 59 fps.
Full Stack Engineer — Marigold Health (2018 - 2021)
- Shipped the intake product end to end: React, Node.js, PostgreSQL, GraphQL.

EDUCATION
BS Computer Science, University of Washington, 2016

SKILLS
React, TypeScript, JavaScript, Node.js, WebGL, GraphQL, PostgreSQL, Python,
performance optimization, accessibility, design systems, Playwright, Docker,
AWS, CI/CD, testing, Git, Figma`;

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}`, extra !== undefined ? JSON.stringify(extra) : '');
  }
}

function section(t: string) {
  console.log(`\n${t}`);
}

// ---------------------------------------------------------------- parser ----
section('Resume parser');
const profile = profileResume(SAMPLE);
check('name', profile.name === 'Dana Okafor', profile.name);
check('email', profile.email === 'dana.okafor@example.com', profile.email);
check('phone', /415/.test(profile.phone), profile.phone);
check('location', /San Francisco/.test(profile.location), profile.location);
check('years ≈ 8-10', profile.yearsExperience >= 8 && profile.yearsExperience <= 10, profile.yearsExperience);
check('title inferred', profile.titles.some((t) => /Frontend/i.test(t)), profile.titles);
check('skills include React+WebGL', profile.skills.includes('React') && profile.skills.includes('WebGL'), profile.skills.slice(0, 8));
check('education parsed', profile.education.some((e) => /BS|Bachelor/i.test(e.degree)), profile.education);
check('experience parsed', profile.experience.length >= 1, profile.experience.length);
check('detects aliases (node.js→Node.js)', detectSkills('we use nodejs and postgres every day').includes('Node.js'));

// ---------------------------------------------------------------- matcher ----
section('Matcher');
const matches = rankJobs(profile, JOBS);
const top = matches[0];
const topJob = JOBS.find((j) => j.id === top.jobId)!;
check('top match is frontend/full-stack', /Frontend|Full Stack/i.test(topJob.title), topJob.title);
check('top score is high', top.score >= 70, top.score);
check('frontend posting scores above rust posting',
  scoreJob(profile, JOBS.find((j) => j.id === 'j-001')!).score > scoreJob(profile, JOBS.find((j) => j.id === 'j-019')!).score);

const av = scoreJob(profile, JOBS.find((j) => j.id === 'j-021')!);
check('clearance knockout is blocked', av.score < 35 && /hard requirement/i.test(av.rationale), { score: av.score });
const vp = scoreJob(profile, JOBS.find((j) => j.id === 'j-022')!);
check('visionOS knockout is blocked', vp.score < 35, vp.score);

const ageFiltered = rankJobs(profile, JOBS, { maxAgeDays: 3 });
check('age filter works', ageFiltered.every((m) => JOBS.find((j) => j.id === m.jobId)!.postedDaysAgo <= 3));

const remote = rankJobs(profile, JOBS, { remoteOnly: true });
check('remote filter works (hybrid is not remote)', remote.every((m) => JOBS.find((j) => j.id === m.jobId)!.remote === 'remote'));

check('form has cover letter + work auth', (() => {
  const f = formFieldsFor(JOBS[0]).map((x) => x.id);
  return f.includes('cover_letter') && f.includes('work_auth') && f.includes('screening_0');
})(), formFieldsFor(JOBS[0]).map((x) => x.id));

// ---------------------------------------------------------------- json ------
section('JSON repair');
check('fenced json', (parseLooseJSON<{ a: number }>('```json\n{"a":1}\n```') as any)?.a === 1);
check('trailing prose', (parseLooseJSON<{ a: number }>('{"a":2} hope that helps!') as any)?.a === 2);
check('trailing comma', (parseLooseJSON<{ a: number }>('{"a":3,}') as any)?.a === 3);
check('single quotes + bare keys', String((parseLooseJSON<{ a: unknown }>("{a: '4'}") as any)?.a) === '4');
check('garbage returns null', parseLooseJSON('the answer is probably fine') === null);

// -------------------------------------------------------- resume rules -----
section('Resume rules');
check('generic prose is not TypeScript, Git, REST or iOS',
  (() => {
    const hits = detectSkills('We need someone who meets requirements, digital products, restaurants, ratios and forest trails.');
    return !['TypeScript', 'Git', 'REST APIs', 'iOS'].some((k) => hits.includes(k));
  })(),
  detectSkills('We need someone who meets requirements, digital products, restaurants, ratios and forest trails.'));
const literal = profileResume(`${SAMPLE}\nBuilt services on Prisma and SOC 2 controls.`);
const prismaJob = { ...JOBS[0], requiredSkills: ['Prisma', 'SOC 2'], niceToHave: [] };
check('literal mention matches a skill the vocabulary does not know',
  scoreJob(literal, prismaJob).matchedSkills.includes('Prisma') && scoreJob(literal, prismaJob).matchedSkills.includes('SOC 2'),
  scoreJob(literal, prismaJob).matchedSkills);
check('the same unknown skill is not matched when the resume lacks it',
  scoreJob(profile, prismaJob).matchedSkills.length === 0, scoreJob(profile, prismaJob).matchedSkills);
const overlap = profileResume('Jane Doe\nSenior Engineer — A (2015 - 2020)\nLead Engineer — B (2018 - 2023)\nBS Computer Science, University of Somewhere, 2010 - 2014');
check('overlapping roles counted once (2015-2023 = 8 years, degree dates ignored)', overlap.yearsExperience === 8, overlap.yearsExperience);
const titled = profileResume('Jane Doe\nAssociate Engineer — Acme (2019 - 2022)\nMaster Data Engineer — Beta (2022 - 2023)\nBS Computer Science, University of Somewhere, 2010 - 2014');
check('job titles containing "Associate" or "Master" still count (3 + 1 = 4 years)', titled.yearsExperience === 4, titled.yearsExperience);
check('email domain is not reported as a portfolio link', !profile.links.some((l) => /example\.com/.test(l)) && !overlap.links.length, profile.links);
const docx = docxToText(
  '<w:document><w:body><w:tbl><w:tblPr><w:tblStyle w:val="Grid"/></w:tblPr><w:tr><w:tc><w:p><w:r><w:t>React</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t xml:space="preserve">Node &amp; Postgres</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>',
);
check('DOCX table text is read and no markup leaks', docx.includes('React') && docx.includes('Node & Postgres') && !/<\/?w:/.test(docx), docx);

// --------------------------------------------------- model answers / gate ----
section('Model answers and the sensitive-topic gate');
check("'1' does not match '10'", !answerMatches('1', '10'));
check("'e' does not match 'motorcycle'", !answerMatches('e', 'motorcycle'));
check('an empty expectation matches nothing', !answerMatches('', '') && !answerMatches('anything', ''));
check('an exact answer with filler and punctuation matches', answerMatches('The answer is Motorcycle.', 'motorcycle') && answerMatches('green', 'green'));

const neverAsked = {
  ready: true,
  complete: async () => { throw new Error('model must not be asked'); },
  completeJSON: async () => { throw new Error('model must not be asked'); },
} as any;
const gated = await answerQuestion(neverAsked, profile, JOBS[0], 'What is your email, and what salary do you expect?');
check('a sensitive topic beats the email heuristic and never reaches the model', gated.answer === '__NEEDS_HUMAN__', gated);
const sensitiveQs = [
  'What is your expected salary?',
  'Are you authorized to work in the US?',
  'Do you require visa sponsorship?',
  'What is your notice period?',
  'Do you hold a security clearance?',
  'Gender identity (optional)',
  'Have you ever been convicted of a felony?',
];
check('every sensitive topic is gated', sensitiveQs.every((q) => !!sensitiveTopic(q)), sensitiveQs.filter((q) => !sensitiveTopic(q)));
check('"collaborate" is not a salary question', !sensitiveTopic('How do you collaborate with product?'));

check('closing sign-off and name are stripped',
  stripSignOff('I built the renderer.\n\nSincerely, Dana Okafor') === 'I built the renderer.');
check('a body line that starts with "Best" is kept',
  stripSignOff('Best practices guided the rewrite.\nBest,\nDana').startsWith('Best practices'));

// ----------------------------------------------------------- refinement ----
section('Model refinement');
const high = { ready: true, completeJSON: async () => ({ score: 90, rationale: 'Strong fit.' }) } as any;
const kJob = JOBS.find((j) => j.id === 'j-021')!;
const kHeur = scoreJob(profile, kJob);
const kRef = await refineMatch(high, profile, kJob, kHeur);
check('a knockout keeps its capped score even when the model says 90', kRef.score === kHeur.score, { heur: kHeur.score, refined: kRef.score });
const wJob = JOBS.find((j) => j.id === 'j-019')!;
const wHeur = scoreJob(profile, wJob);
const wRef = await refineMatch(high, profile, wJob, wHeur);
check('a weak stretch posting is blended with the model view, not frozen', !wHeur.knockout && wRef.score > wHeur.score, { heur: wHeur.score, refined: wRef.score });

// ------------------------------------------------------------ human checks ----
section('Human-check hand-offs');
const aiChecks = new Map<string, ReturnType<typeof nextChallenge>>();
// The language check sits at wall #3 and the application id picks which one, so vary the id.
for (let i = 0; i < 30; i++) {
  const c = nextChallenge(`app-selftest-${i}`, 2);
  if (c.solvableBy === 'ai') aiChecks.set(c.answer!, c);
}
check('language checks are drawn', aiChecks.size >= 2, [...aiChecks.keys()]);
for (const [answer, c] of aiChecks) {
  const t = makePendingChallenge('a', 'j', 't', 'c', 's', c);
  check(`the portal's answer "${answer}" never reaches the operator`,
    t.expected === undefined && (t as any).suggestion === undefined && !(t.challengePrompt ?? '').includes(answer) && !(t.question ?? '').includes(answer),
    t);
}

// ---------------------------------------------------------------- pilot -----
section('Pilot end-to-end (heuristic mode, simulated operator)');

const store = useStore.getState();
store.setProfile(profile, 'selftest.txt');
const queue = matches.filter((m) => m.score >= 55).slice(0, 4);
check('queue non-empty', queue.length >= 3, queue.length);

const criteria = {
  ...useStore.getState().criteria,
  minScore: 55,
  maxApplications: 4,
  autoSubmit: true,
  humanCheckTimeoutMs: 20_000,
};

// Stand in for the human: answer everything the pilot parks on.
let answersGiven = 0;
let challengesSeen = new Set<string>();
const operator = setInterval(() => {
  const { pending } = useStore.getState();
  for (const p of pending) {
    if (p.challenge === 'text-image') challengesSeen.add('text-image');
    if (p.challenge === 'select-image') challengesSeen.add('select-image');
    if (p.challenge === 'slider') challengesSeen.add('slider');
    if (p.kind === 'question') challengesSeen.add('question');
    const value =
      p.expected ??
      p.suggestion ??
      (/(sponsor|visa|authoris|authoriz|clearance)/i.test(p.question ?? '') ? 'Yes, authorised' : 'Available in four weeks');
    pilot.answerPending(p.id, value);
    answersGiven++;
  }
}, 120);

const started = Date.now();
await pilot.run(null, queue, criteria, profile);
clearInterval(operator);

const apps = useStore.getState().applications;
const submitted = apps.filter((a) => a.status === 'submitted');
console.log(`  · ran in ${((Date.now() - started) / 1000).toFixed(1)}s · ${apps.length} applications · ${submitted.length} submitted · ${answersGiven} operator answers · challenges: ${[...challengesSeen].join(', ') || 'none'}`);

check('one application per queued job', apps.length === queue.length, { apps: apps.length, queue: queue.length });
check('at least one submitted', submitted.length >= 1, submitted.length);
check('every submitted app has a receipt', submitted.every((a) => !!a.confirmationId));
check('every submitted app holds a cover letter', submitted.every((a) => (a.coverLetter ?? '').length > 40));
check('all apps reached a terminal state', apps.every((a) => ['submitted', 'failed'].includes(a.status)), apps.map((a) => a.status));
check('cover letters do not invent employers', submitted.every((a) => !/Google|Amazon|Meta\b/.test(a.coverLetter ?? '')));
check('sensitive questions escalated', apps.some((a) => a.steps.some((s) => s.questionId && s.detail?.startsWith('Your answer'))));
check('nothing left pending', useStore.getState().pending.length === 0);
check('audit log is populated', useStore.getState().logs.length > 20, useStore.getState().logs.length);
check('phase finished', useStore.getState().phase === 'finished', useStore.getState().phase);

const nap = (ms: number) => new Promise((r) => setTimeout(r, ms));
const answerAll = () =>
  setInterval(() => {
    for (const p of useStore.getState().pending) pilot.answerPending(p.id, p.expected ?? p.suggestion ?? 'Yes');
  }, 50);
const snapshotRun = () =>
  JSON.stringify({
    logs: useStore.getState().logs.length,
    apps: useStore.getState().applications.map((a) => [a.status, a.steps.map((st) => st.status).join(',')]),
  });
const headersOf = () => useStore.getState().logs.filter((l) => /^── /.test(l.text));
const opensOf = () => useStore.getState().logs.filter((l) => /^Opening the/.test(l.text));

section('Pilot: pause / resume / stop');
pilot.speed = 4;
{
  const op = answerAll();
  const pr = pilot.run(null, queue.slice(0, 2), { ...criteria, maxApplications: 2, humanCheckTimeoutMs: 20_000 }, profile);
  await nap(500);
  pilot.pause();
  check('phase is paused', useStore.getState().phase === 'paused', useStore.getState().phase);
  await nap(800);
  const frozen = snapshotRun();
  await nap(900);
  check('pause takes effect: nothing advances while paused', snapshotRun() === frozen);
  pilot.resume();
  check('phase is running after resume', useStore.getState().phase === 'running', useStore.getState().phase);
  await nap(400);
  check('resume moves the run again', snapshotRun() !== frozen);
  pilot.stop();
  await pr;
  clearInterval(op);
  check('phase is stopped after stop()', useStore.getState().phase === 'stopped', useStore.getState().phase);
}

section('Pilot: stop then start runs one loop');
{
  const op = answerAll();
  const first = pilot.run(null, queue.slice(0, 2), { ...criteria, maxApplications: 2, humanCheckTimeoutMs: 20_000 }, profile);
  await nap(600);
  pilot.stop();
  const second = pilot.run(null, queue.slice(0, 2), { ...criteria, maxApplications: 2, humanCheckTimeoutMs: 20_000 }, profile);
  await Promise.all([first, second]);
  clearInterval(op);
  const apps = useStore.getState().applications;
  check('one run header per posting after restart', headersOf().length === 2, headersOf().map((l) => l.text.slice(0, 9)));
  check('one navigation per posting after restart', opensOf().length === 2, opensOf().length);
  check('applications equal the queue after restart (no duplicates)', apps.length === 2, apps.length);
  check('nothing left open after restart', apps.every((a) => ['submitted', 'failed'].includes(a.status)), apps.map((a) => a.status));
}

section('Pilot: stop releases a run parked on the operator');
{
  // No operator here: the first posting parks on its work-authorisation question and waits forever (timeout 0).
  const parked = pilot.run(null, queue.slice(0, 1), { ...criteria, humanCheckTimeoutMs: 0 }, profile);
  let waited = 0;
  while (useStore.getState().pending.length === 0 && waited < 20_000) {
    await nap(100);
    waited += 100;
  }
  check('the run parks on a question', useStore.getState().pending.length > 0, waited);
  const t0 = Date.now();
  pilot.stop();
  await parked;
  check('stop releases the parked run promptly', Date.now() - t0 < 2_000, Date.now() - t0);
  check('stop clears the pending queue', useStore.getState().pending.length === 0, useStore.getState().pending.length);
}

section('Pilot: an unexpected error fails that application, not the run');
{
  let reads = 0;
  // The first read is the run header; the second is inside the first application's analyze step.
  const broken = { get ready() { if (++reads > 1) throw new Error('engine exploded'); return false; }, interrupt() {} } as any;
  await pilot.run(broken, queue.slice(0, 1), { ...criteria, humanCheckTimeoutMs: 20_000 }, profile);
  const a = useStore.getState().applications[0];
  check('the errored application is failed', a?.status === 'failed', a?.status);
  check('its error message is kept', !!a?.error && a.error.includes('engine exploded'), a?.error);
  check('no step is left open', (a?.steps ?? []).every((st) => !['pending', 'running', 'blocked'].includes(st.status)), a?.steps.map((st) => st.status));
  check('phase finishes rather than sticking', useStore.getState().phase === 'finished', useStore.getState().phase);
}
pilot.speed = 1;

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
