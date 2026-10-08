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
check('remote filter works', remote.every((m) => JOBS.find((j) => j.id === m.jobId)!.remote !== 'onsite'));

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

section('Pilot: pause / resume / stop');
useStore.getState().resetRun();
const runPromise = pilot.run(null, queue.slice(0, 1), { ...criteria, maxApplications: 1 }, profile);
await new Promise((r) => setTimeout(r, 400));
pilot.pause();
check('phase is paused', useStore.getState().phase === 'paused');
await new Promise((r) => setTimeout(r, 300));
check('paused run makes no progress', useStore.getState().applications.every((a) => a.status === 'filling' || a.status === 'queued'));
pilot.resume();
await new Promise((r) => setTimeout(r, 200));
pilot.stop();
await runPromise;
check('phase is stopped after stop()', useStore.getState().phase === 'stopped', useStore.getState().phase);

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
