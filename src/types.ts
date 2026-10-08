// ---------------------------------------------------------------------------
// Core domain types for JobPilot
// ---------------------------------------------------------------------------

export interface ResumeProfile {
  name: string;
  email: string;
  phone: string;
  location: string;
  links: string[];
  summary: string;
  skills: string[];
  titles: string[];
  yearsExperience: number;
  education: { degree: string; school: string; year?: string }[];
  experience: {
    title: string;
    company: string;
    dates: string;
    bullets: string[];
  }[];
  /** Everything the parser could not place, kept verbatim. */
  rawText: string;
}

export interface Job {
  id: string;
  title: string;
  company: string;
  location: string;
  remote: 'remote' | 'hybrid' | 'onsite';
  salary: string;
  postedDaysAgo: number;
  employment: 'full-time' | 'contract' | 'part-time';
  seniority: 'junior' | 'mid' | 'senior' | 'staff';
  description: string;
  responsibilities: string[];
  requiredSkills: string[];
  niceToHave: string[];
  questions: string[];
  /** Skills the fictional ATS treats as its hard requirements. */
  knockout?: string[];
  applicantCount: number;
}

export interface JobMatch {
  jobId: string;
  score: number; // 0-100
  verdict: 'strong' | 'good' | 'stretch';
  matchedSkills: string[];
  missingSkills: string[];
  rationale: string;
  /** Whether the model or the heuristic engine produced this. */
  source: 'ai' | 'heuristic';
  /** The posting's hard knockout fired: the score is capped and must not be model-blended upward. */
  knockout?: boolean;
}

export type StepKind =
  | 'navigate'
  | 'analyze'
  | 'match'
  | 'field'
  | 'answer'
  | 'human-check'
  | 'submit'
  | 'confirmed';

export type StepStatus = 'pending' | 'running' | 'done' | 'blocked' | 'skipped' | 'failed';

export interface ApplicationStep {
  id: string;
  kind: StepKind;
  status: StepStatus;
  label: string;
  detail?: string;
  startedAt?: number;
  finishedAt?: number;
  answer?: string; // filled field / question answer
  confidence?: number;
  questionId?: string; // set when the step needs the human
}

export type ApplicationStatus =
  | 'queued'
  | 'analyzing'
  | 'filling'
  | 'needs-you'
  | 'submitted'
  | 'failed';

export interface Application {
  id: string;
  jobId: string;
  job: Job;
  status: ApplicationStatus;
  score?: number;
  match?: JobMatch;
  steps: ApplicationStep[];
  /** Cover-letter / "why do you want to work here" text the model drafted. */
  coverLetter?: string;
  headline?: string;
  confirmationId?: string;
  createdAt: number;
  updatedAt: number;
  error?: string;
}

export type PendingKind = 'question' | 'human-check';

export interface PendingTask {
  id: string;
  applicationId: string;
  jobId: string;
  jobTitle: string;
  company: string;
  kind: PendingKind;
  /** For questions */
  question?: string;
  stepId?: string;
  /** For human checks */
  challenge?: 'checkbox' | 'text-image' | 'slider' | 'select-image';
  challengePrompt?: string;
  /** Answers for text-image challenges, validated in the UI. */
  expected?: string;
  /** Image tiles for select-image challenges. */
  tiles?: { glyph: string; label: string; correct: boolean }[];
  /** AI's suggested answer, shown to the human for approval. */
  suggestion?: string;
  confidence?: number;
  reason?: string;
  /** Set when the pilot is parked at the final submit button. */
  gate?: 'submit';
  createdAt: number;
}

export type AgentPhase = 'idle' | 'running' | 'paused' | 'finished' | 'stopped';

export interface LogEntry {
  id: string;
  ts: number;
  level: 'info' | 'ai' | 'warn' | 'good' | 'human';
  text: string;
  appId?: string;
}

export type ModelBackend = 'webllm';

export interface EngineStatus {
  state:
    | 'idle'
    | 'unsupported'
    | 'downloading'
    | 'loading'
    | 'ready'
    | 'generating'
    | 'error';
  backend: ModelBackend;
  modelId: string;
  progress: number; // 0..1
  progressText: string;
  tokensPerSec?: number;
  error?: string;
}
