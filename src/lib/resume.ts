import type { ResumeProfile } from '../types';

// ---------------------------------------------------------------------------
// Heuristic resume profiler.
//
// This is the *deterministic* half of the pipeline: extraction, skill
// normalisation, and scoring always work, even with no GPU, no WebGPU, or a
// model that is still downloading. The LLM refines and explains; it is never
// the single point of failure.
// ---------------------------------------------------------------------------

/** Skill vocabulary the matcher understands, with the spellings people actually type. */
export const SKILL_ALIASES: Record<string, string[]> = {
  React: ['react', 'react.js', 'reactjs'],
  TypeScript: ['typescript', 'ts'],
  JavaScript: ['javascript', 'js', 'es6', 'ecmascript'],
  'Node.js': ['node', 'node.js', 'nodejs'],
  Python: ['python'],
  Go: ['golang', ' go '],
  Rust: ['rust'],
  'C++': ['c++', 'cpp'],
  Java: ['java'],
  'C#': ['c#', '.net'],
  Swift: ['swift', 'swiftui'],
  SwiftUI: ['swiftui'],
  'Objective-C': ['objective-c'],
  iOS: ['ios', 'iphone'],
  visionOS: ['visionos'],
  Metal: ['metal', 'shader', 'shaders'],
  RealityKit: ['realitykit', 'arkit'],
  'Spatial Computing': ['spatial computing', 'mixed reality', 'xr'],
  WebGL: ['webgl', 'webgl2', 'three.js', 'threejs'],
  WebGPU: ['webgpu'],
  'Performance Optimization': [
    'performance',
    'optimization',
    'optimisation',
    'profiling',
    'lighthouse',
    'core web vitals',
    '60fps',
  ],
  GraphQL: ['graphql', 'apollo'],
  'REST APIs': ['rest apis', 'rest api', 'restful', 'http api'],
  'REST API': ['rest api', 'rest apis'],
  PostgreSQL: ['postgres', 'postgresql', 'psql'],
  SQL: ['sql', 'mysql', 'mssql', 'queries'],
  Redis: ['redis'],
  Kafka: ['kafka', 'event streaming'],
  gRPC: ['grpc', 'protobuf'],
  Docker: ['docker', 'containers'],
  Kubernetes: ['kubernetes', 'k8s', 'eks', 'gke'],
  Terraform: ['terraform', 'iac', 'infrastructure as code'],
  AWS: ['aws', 'amazon web services', 'lambda', 's3', 'ec2'],
  'CI/CD': ['ci/cd', 'cicd', 'continuous integration', 'continuous delivery', 'github actions', 'jenkins'],
  'GitHub Actions': ['github actions'],
  Linux: ['linux', 'unix', 'bash', 'shell'],
  Observability: ['observability', 'monitoring', 'prometheus', 'grafana', 'datadog', 'opentelemetry'],
  'Distributed Systems': ['distributed systems', 'microservices', 'scalability'],
  PyTorch: ['pytorch', 'torch'],
  TensorFlow: ['tensorflow', 'keras'],
  Embeddings: ['embeddings', 'vector search', 'vector database', 'faiss', 'pgvector', 'sentence transformers'],
  'Information Retrieval': ['information retrieval', 'search relevance', 'ranking', 'ranker', 'elasticsearch', 'opensearch'],
  'LLM fine-tuning': ['fine-tuning', 'finetuning', 'lora', 'peft', 'llm', 'large language model'],
  ML: ['machine learning', 'ml', 'deep learning', 'neural network'],
  Statistics: ['statistics', 'statistical', 'regression', 'hypothesis test'],
  'A/B Testing': ['a/b test', 'a/b testing', 'ab test', 'ab testing', 'experimentation', 'experiment design'],
  dbt: ['dbt'],
  Snowflake: ['snowflake', 'bigquery', 'warehouse'],
  Looker: ['looker', 'tableau', 'superset', 'metabase'],
  'Data Visualization': ['data visualization', 'charts', 'dashboards', 'dashboard'],
  Excel: ['excel', 'spreadsheet', 'google sheets'],
  Playwright: ['playwright'],
  Cypress: ['cypress'],
  Testing: ['testing', 'unit test', 'test suite', 'jest', 'vitest', 'pytest', 'tdd'],
  'Test Design': ['test plan', 'test strategy', 'qa'],
  Accessibility: ['accessibility', 'a11y', 'wcag', 'screen reader', 'aria'],
  'Design Systems': ['design system', 'component library', 'storybook', 'design tokens'],
  CSS: ['css', 'sass', 'scss', 'tailwind', 'styled-components'],
  HTML: ['html', 'html5', 'semantic markup'],
  Figma: ['figma', 'sketch', 'adobe xd'],
  'Product Design': ['product design', 'ux design', 'ui design', 'interaction design'],
  Prototyping: ['prototyping', 'wireframe', 'prototype'],
  'User Research': ['user research', 'usability', 'interviews', 'user testing'],
  'Technical Writing': ['technical writing', 'documentation', 'docs', 'developer docs'],
  OpenAPI: ['openapi', 'swagger'],
  Markdown: ['markdown', 'mdx'],
  'API documentation': ['api documentation', 'api reference', 'docs site'],
  Git: ['git', 'github', 'gitlab', 'version control'],
  'Engineering Management': ['engineering manager', 'managed a team', 'people management', 'direct reports', 'mentored'],
  Hiring: ['hiring', 'interviewing', 'recruiting'],
  Roadmapping: ['roadmap', 'roadmapping', 'planning'],
  'Stakeholder Communication': ['stakeholder', 'cross-functional', 'executive'],
  Payments: ['payments', 'billing', 'stripe', 'ledger', 'reconciliation'],
  Fintech: ['fintech', 'financial'],
  AppSec: ['appsec', 'application security', 'security review', 'owasp', 'vulnerability'],
  'Threat Modeling': ['threat model', 'threat modeling', 'security architecture'],
  OWASP: ['owasp', 'semgrep', 'sast', 'dast', 'burp'],
  'Security Clearance': ['security clearance', 'ts/sci', 'secret clearance'],
  Robotics: ['robotics', 'ros', 'slam'],
  Perception: ['perception', 'lidar', 'computer vision', 'sensor fusion'],
  Autonomy: ['autonomous', 'autonomy', 'self-driving'],
  'Systems Programming': ['systems programming', 'low-level', 'memory management'],
  Profiling: ['profil', 'p99', 'latency budget'],
  Concurrency: ['concurrency', 'multithread', 'async runtime', 'tokio'],
  'Paid Acquisition': ['paid acquisition', 'google ads', 'meta ads', 'ppc', 'performance marketing'],
  'Lifecycle Marketing': ['lifecycle', 'email marketing', 'crm', 'retention marketing', 'push'],
  Analytics: ['analytics', 'mixpanel', 'amplitude', 'ga4'],
  Copywriting: ['copywriting', 'copy ', 'messaging'],
  SEO: ['seo', 'search engine optim'],
  Communication: ['communication', 'stakeholder', 'presentation', 'writing'],
  'Customer Support': ['customer support', 'support engineer', 'help desk', 'ticket'],
  Debugging: ['debugging', 'troubleshoot', 'root cause', 'reproduced'],
  'Technical Sales': ['technical sales', 'sales engineer', 'solutions engineer', 'pre-sales'],
  'Core Data': ['core data', 'coredata', 'realm', 'sqlite'],
  'Unit Testing': ['unit testing', 'xctest'],
  Motion: ['animation', 'motion design', 'framer motion', 'gsap'],
};

const REGEX_SPECIAL = '.*+?^${}()|[]\\';
/** Escape a literal string for use inside a RegExp. */
export const escapeRegex = (s: string) =>
  Array.from(s, (c) => (REGEX_SPECIAL.includes(c) ? `\\${c}` : c)).join('');

/**
 * One regex per alias, anchored on word edges. A bare substring test would
 * read "requirements" as TypeScript ("ts"), "digital" as Git, "restaurants"
 * as REST, and "ratios" as iOS. Letters are the boundary; digits are not, so
 * "python3" and "s3" still resolve.
 */
function aliasRegex(alias: string): RegExp {
  const lower = alias.toLowerCase();
  const pre = /^[a-z]/.test(lower) ? '(?<![a-z])' : '';
  // Allow a plural ("design systems", "unit tests") but nothing longer.
  const post = /[a-z]$/.test(lower) ? '(?:e?s)?(?![a-z])' : '';
  return new RegExp(pre + escapeRegex(lower) + post);
}

const COMPILED_ALIASES = Object.keys(SKILL_ALIASES).map((key) => ({
  key: key.trim(),
  patterns: SKILL_ALIASES[key].map(aliasRegex),
}));

function normalise(text: string) {
  return ` ${text.toLowerCase().replace(/[\u2018\u2019]/g, "'").replace(/\s+/g, ' ')} `;
}

/** Find every known skill mentioned anywhere in a blob of text. */
export function detectSkills(text: string): string[] {
  const hay = normalise(text);
  const found = new Set<string>();
  for (const { key, patterns } of COMPILED_ALIASES) {
    if (patterns.some((re) => re.test(hay))) found.add(key);
  }
  return [...found];
}

/** Convert an arbitrary job-skill string into the vocabulary keys it implies. */
export function jobSkillKeys(skill: string): string[] {
  const direct = detectSkills(skill);
  if (direct.length) return direct;
  const trimmed = skill.trim();
  // Unknown vocabulary — treat the literal (lowercased) as its own key so it
  // still participates in set arithmetic.
  return [trimmed];
}

const TITLE_PATTERNS: { re: RegExp; title: string }[] = [
  { re: /\b(staff|principal)\b.{0,24}\bengineer\b/i, title: 'Staff Engineer' },
  { re: /\b(senior|sr\.?|lead)\b.{0,24}\b(frontend|front-end|ui) engineer\b/i, title: 'Senior Frontend Engineer' },
  { re: /\b(senior|sr\.?|lead)\b.{0,24}\b(backend|back-end|server) engineer\b/i, title: 'Senior Backend Engineer' },
  { re: /\b(senior|sr\.?|lead)\b.{0,24}\b(full[- ]?stack) engineer\b/i, title: 'Senior Full Stack Engineer' },
  { re: /\b(senior|sr\.?|lead)\b.{0,24}\b(software|platform|systems?|data|ml|machine learning) engineer\b/i, title: 'Senior Software Engineer' },
  { re: /\b(engineering manager|em|manager,? engineering)\b/i, title: 'Engineering Manager' },
  { re: /\b(ml|machine learning|ai)\s+engineer\b/i, title: 'Machine Learning Engineer' },
  { re: /\b(data scientist|data science)\b/i, title: 'Data Scientist' },
  { re: /\b(data analyst|business analyst)\b/i, title: 'Data Analyst' },
  { re: /\b(devops|sre|site reliability|platform engineer|infrastructure engineer)\b/i, title: 'DevOps / Platform Engineer' },
  { re: /\b(security engineer|appsec|application security)\b/i, title: 'Security Engineer' },
  { re: /\b(product designer|product design|ux designer|ui\/ux)\b/i, title: 'Product Designer' },
  { re: /\b(qa|quality assurance|test automation|sdet)\b/i, title: 'QA Engineer' },
  { re: /\b(technical writer|documentation engineer|docs engineer)\b/i, title: 'Technical Writer' },
  { re: /\b(ios|android|mobile)\s+(software\s+)?(engineer|developer)\b/i, title: 'Mobile Engineer' },
  { re: /\b(solutions? engineer|sales engineer)\b/i, title: 'Solutions Engineer' },
  { re: /\b(marketing manager|growth)\b/i, title: 'Growth Marketing Manager' },
  { re: /\b(support engineer|customer engineer)\b/i, title: 'Support Engineer' },
  { re: /\b(frontend|front-end)\s+(engineer|developer)\b/i, title: 'Frontend Engineer' },
  { re: /\b(backend|back-end)\s+(engineer|developer)\b/i, title: 'Backend Engineer' },
  { re: /\bfull[- ]?stack\b/i, title: 'Full Stack Engineer' },
  { re: /\b(web|software)\s+(developer|engineer)\b/i, title: 'Software Engineer' },
];

const LOCATION_RE =
  /\b([A-Z][a-zA-Z.'-]+(?:\s+[A-Z][a-zA-Z.'-]+){0,2},\s*(?:[A-Z]{2}|[A-Z][a-z]+))(?:\s*,?\s*(?:US|USA|United States|UK|Canada|Germany|Netherlands|EU))?\b/;
const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.]{2,}/;
const PHONE_RE =
  /(?:\+?\d{1,3}[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b|\+\d{2}[\s.-]?\d{2,4}[\s.-]?\d{3,4}[\s.-]?\d{3,4}/;
const URL_RE = /(?<![@\w.-])(?:https?:\/\/)?(?:www\.)?(?:github\.com|gitlab\.com|linkedin\.com|[\w-]+\.(?:dev|io|com|me|net|org))\/?[\w./#-]*/gi;

const DEGREE_RE =
  /\b(B\.?\s?S\.?|B\.?\s?A\.?|B\.?\s?E\.?|Bachelor(?:'s)?(?: of [A-Za-z ]+)?|M\.?\s?S\.?|M\.?\s?A\.?|Master(?:'s)?(?: of [A-Za-z ]+)?|Ph\.?\s?D\.?|Doctorate|MBA|Associate(?:'s)?)\b[^\n]{0,90}/gi;

const SPAN_RE = /((?:19|20)\d{2})\s*(?:-|–|—|to)\s*((?:19|20)\d{2}|present|current|now)/gi;
// Degree-specific tokens only: "Associate Engineer" or "Master Data Engineer" are job titles, not degrees.
const EDUCATION_RE =
  /(?<![a-z])(university|college|institute|bachelor'?s?|master'?s|mba|ph\.?\s?d|diploma|degree|b\.?s\.?|b\.?a\.?|m\.?s\.?)(?![a-z])/i;

function guessYearsExperience(text: string): number {
  // 1. Explicit statements: "8+ years of experience", "over 6 years"
  const explicit = [
    ...text.matchAll(/(\d{1,2})\s*\+?\s*(?:years?|yrs?)(?:\s+of)?\s*(?:professional\s+|industry\s+|software\s+)?experience/gi),
    ...text.matchAll(/(?:over|more than|nearly)\s+(\d{1,2})\s*(?:years?|yrs?)/gi),
  ];
  if (explicit.length) {
    const years = Math.max(...explicit.map((m) => parseInt(m[1], 10)));
    if (years > 0 && years < 45) return years;
  }
  // 2. Dated role spans. Overlapping roles must not be double-counted, and a
  //    degree's dates ("2010 - 2014, University of …") are not work experience.
  const now = new Date().getFullYear();
  const intervals: [number, number][] = [];
  for (const line of text.split('\n')) {
    if (EDUCATION_RE.test(line)) continue;
    for (const [, a, b] of line.matchAll(SPAN_RE)) {
      const start = parseInt(a, 10);
      const end = /present|current|now/i.test(b) ? now : parseInt(b, 10);
      if (end < start || end - start > 40) continue;
      if (start < 1985 || start > now + 1) continue;
      intervals.push([start, end]);
    }
  }
  intervals.sort((x, y) => x[0] - y[0]);
  let total = 0;
  let current: [number, number] | null = null;
  for (const [start, end] of intervals) {
    if (!current || start > current[1]) {
      if (current) total += current[1] - current[0];
      current = [start, end];
    } else {
      current[1] = Math.max(current[1], end);
    }
  }
  if (current) total += current[1] - current[0];
  if (total > 0) return Math.min(45, Math.round(total));
  // 3. Seniorsity words as a last resort
  if (/\b(principal|staff|head of|director)\b/i.test(text)) return 12;
  if (/\bsenior\b|\bsr\./i.test(text)) return 7;
  if (/\bjunior|intern|entry[- ]level|graduate\b/i.test(text)) return 1;
  return 4;
}

function extractSection(text: string, headings: string[], maxChars = 700): string {
  const lines = text.split('\n');
  const idx = lines.findIndex((l) =>
    headings.some((h) => l.trim().toLowerCase().replace(/[:•-]/g, '').trim() === h),
  );
  if (idx === -1) return '';
  const out: string[] = [];
  for (let i = idx + 1; i < lines.length && out.join(' ').length < maxChars; i++) {
    const line = lines[i].trim();
    if (!line) {
      if (out.length) break;
      continue;
    }
    // Stop if we hit what looks like the next heading (short, title-case-ish line)
    if (
      out.length > 2 &&
      line.length < 42 &&
      /^[A-Z][A-Za-z &/'-]+$/.test(line) &&
      !/[.,]/.test(line)
    )
      break;
    out.push(line);
  }
  return out.join(' ').replace(/\s+/g, ' ').trim();
}

function bulletLines(text: string, limit = 8): string[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^[-•*·▪‣–—>]\s*\S/.test(l) || /^\d+[.)]\s+\S/.test(l))
    .map((l) => l.replace(/^[-•*·▪‣–—>]\s*|^\d+[.)]\s+/, '').trim())
    .filter((l) => l.length > 24)
    .slice(0, limit);
}

/** Parse a raw resume blob into a structured profile using deterministic rules. */
export function profileResume(rawText: string): ResumeProfile {
  const text = rawText.replace(/\r\n?/g, '\n');
  const lines = text.split('\n').map((l) => l.trim());

  const email = text.match(EMAIL_RE)?.[0] ?? '';
  const phone = text.match(PHONE_RE)?.[0]?.trim() ?? '';
  const location = text.match(LOCATION_RE)?.[1] ?? '';
  const links = [...new Set((text.match(URL_RE) ?? []).map((u) => u.replace(/[),.]$/, '')))]
    .slice(0, 5);

  // Name: first non-empty line that looks like a person's name and is not
  // contact junk.
  let name = '';
  for (const line of lines.slice(0, 8)) {
    if (!line) continue;
    if (EMAIL_RE.test(line) || PHONE_RE.test(line) || /http|www\./i.test(line)) continue;
    const words = line.split(/\s+/);
    const candidate = line.replace(/^(resume|curriculum vitae|cv)[\s:–-]*/i, '').trim();
    if (
      candidate.length > 2 &&
      candidate.length < 45 &&
      words.length <= 5 &&
      /^[A-Z][A-Za-z.'’-]*(?:\s+[A-Z][A-Za-z.'’-]*){0,4}$/.test(candidate)
    ) {
      name = candidate;
      break;
    }
  }
  if (!name) name = email ? email.split('@')[0].replace(/[._]/g, ' ') : 'Unnamed Candidate';
  // "DANA OKAFOR" is a person, not a sentence. Normalise shouted names.
  if (name && name === name.toUpperCase()) {
    name = name
      .toLowerCase()
      .split(/(\s+|-)/)
      .map((part) => (/^[a-z]/.test(part) ? part[0].toUpperCase() + part.slice(1) : part))
      .join('');
  }

  // Titles: scan the top third of the resume for role phrases
  const head = lines.slice(0, Math.min(lines.length, 40)).join('\n');
  const titles = new Set<string>();
  for (const { re, title } of TITLE_PATTERNS) {
    if (re.test(head) || re.test(text)) titles.add(title);
  }
  if (!titles.size) titles.add('Software Engineer');

  const skills = detectSkills(text);
  const summary =
    extractSection(text, ['summary', 'professional summary', 'profile', 'about', 'objective', 'about me']) ||
    bulletLines(text, 2).join(' ') ||
    lines.filter(Boolean).slice(1, 4).join(' ');

  const education: ResumeProfile['education'] = [];
  for (const m of text.matchAll(DEGREE_RE)) {
    const chunk = m[0].replace(/\s+/g, ' ').trim();
    const schoolMatch = chunk.match(/(?:[A-Z][\w.'&-]*\s){0,3}(?:University|College|Institute|School|Polytechnic|Academy)[\w\s.]*/);
    const yearMatch = chunk.match(/(19|20)\d{2}/);
    education.push({
      degree: chunk.split(/,|\bat\b|–|-/)[0].trim(),
      school: schoolMatch?.[0]?.trim() ?? '',
      year: yearMatch?.[0],
    });
    if (education.length >= 4) break;
  }

  // Experience: group lines that look like "Title — Company" / "Title at Company"
  const experience: ResumeProfile['experience'] = [];
  const expRe =
    /^((?:senior|staff|principal|lead|junior|sr\.?|jr\.?)?\s*[A-Z][A-Za-z/&.+-]*(?:\s+[A-Za-z/&.+-]+){0,3})\s*(?:[-–—|@,]|\bat\b)\s*([A-Z][\w&.'-]*(?:\s+[\w&.'-]+){0,4})/;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(expRe);
    if (!m) continue;
    const title = m[1].trim();
    if (title.length < 4 || /^(university|college|skills|education|projects)$/i.test(title)) continue;
    const company = m[2].trim();
    const dateLine = [line, lines[i + 1] ?? '', lines[i - 1] ?? ''].find((l) =>
      /(19|20)\d{2}\s*(?:-|–|—|to)\s*((19|20)\d{2}|present|current|now)/i.test(l),
    );
    const dates = dateLine?.match(/((?:19|20)\d{2})\s*(?:-|–|—|to)\s*((?:19|20)\d{2}|[Pp]resent|[Cc]urrent|[Nn]ow)/)?.[0] ?? '';
    // Collect the bullet block that follows
    const bullets: string[] = [];
    for (let j = i + 1; j < Math.min(lines.length, i + 9); j++) {
      const l = lines[j];
      if (/^[-•*·▪‣–—>]\s*\S/.test(l)) bullets.push(l.replace(/^[-•*·▪‣–—>]\s*/, '').trim());
      else if (bullets.length && l && !/^[-•*·▪‣–—>]/.test(l)) break;
    }
    experience.push({ title, company, dates, bullets: bullets.slice(0, 5) });
    if (experience.length >= 6) break;
  }

  if (!experience.length) {
    const bullets = bulletLines(text, 6);
    if (bullets.length) {
      experience.push({
        title: [...titles][0],
        company: '',
        dates: text.match(/((?:19|20)\d{2})\s*(?:-|–|—|to)\s*((?:19|20)\d{2}|present|current|now)/i)?.[0] ?? '',
        bullets,
      });
    }
  }

  return {
    name,
    email,
    phone,
    location,
    links,
    summary: summary.slice(0, 900),
    skills,
    titles: [...titles].slice(0, 4),
    yearsExperience: guessYearsExperience(text),
    education,
    experience,
    rawText: text,
  };
}

/** Skills the profile demonstrably has, as vocabulary keys. */
export function profileSkillKeys(profile: ResumeProfile): Set<string> {
  return new Set([...profile.skills, ...detectSkills(profile.rawText)]);
}
