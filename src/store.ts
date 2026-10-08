import { create } from 'zustand';
import type {
  AgentPhase,
  Application,
  ApplicationStep,
  EngineStatus,
  Job,
  JobMatch,
  LogEntry,
  PendingTask,
  ResumeProfile,
} from './types';

export interface Criteria {
  minScore: number;
  maxApplications: number;
  maxAgeDays: number;
  remoteOnly: boolean;
  /** When false, the agent stops at the final review screen and hands you the trigger. */
  autoSubmit: boolean;
  /** How long the pilot waits for you on a human check before skipping (ms). 0 = forever. */
  humanCheckTimeoutMs: number;
}

interface State {
  profile: ResumeProfile | null;
  profileFile: string | null;
  aiSummary: string;
  engine: EngineStatus;
  backendLabel: string;
  matches: JobMatch[];
  selectedJobIds: string[];
  applications: Application[];
  pending: PendingTask[];
  logs: LogEntry[];
  phase: AgentPhase;
  activeAppId: string | null;
  criteria: Criteria;
  busyExtracting: boolean;

  // actions
  setProfile: (p: ResumeProfile | null, file: string | null) => void;
  setAiSummary: (s: string) => void;
  setEngine: (s: EngineStatus) => void;
  setBackendLabel: (s: string) => void;
  setMatches: (m: JobMatch[]) => void;
  toggleJob: (id: string) => void;
  setSelectedJobIds: (ids: string[]) => void;
  setCriteria: (patch: Partial<Criteria>) => void;
  setPhase: (p: AgentPhase) => void;
  setActiveAppId: (id: string | null) => void;
  setBusyExtracting: (b: boolean) => void;

  addApplication: (app: Application) => void;
  patchApplication: (id: string, patch: Partial<Application>) => void;
  patchStep: (appId: string, stepId: string, patch: Partial<ApplicationStep>) => void;
  pushStep: (appId: string, step: ApplicationStep) => void;

  addPending: (t: PendingTask) => void;
  resolvePending: (id: string) => void;

  log: (level: LogEntry['level'], text: string, appId?: string) => void;
  clearLogs: () => void;
  resetRun: () => void;
}

export const DEFAULT_CRITERIA: Criteria = {
  minScore: 55,
  maxApplications: 6,
  maxAgeDays: 30,
  remoteOnly: false,
  autoSubmit: true,
  humanCheckTimeoutMs: 240_000,
};

let logSeq = 0;
let appSeq = 0;

export const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(appSeq++).toString(36)}`;

export const useStore = create<State>((set) => ({
  profile: null,
  profileFile: null,
  aiSummary: '',
  engine: {
    state: 'idle',
    backend: 'webllm',
    modelId: '',
    progress: 0,
    progressText: 'Not started',
  },
  backendLabel: 'WebLLM · WebGPU · runs on your GPU',
  matches: [],
  selectedJobIds: [],
  applications: [],
  pending: [],
  logs: [],
  phase: 'idle',
  activeAppId: null,
  criteria: DEFAULT_CRITERIA,
  busyExtracting: false,

  setProfile: (profile, file) => set({ profile, profileFile: file }),
  setAiSummary: (aiSummary) => set({ aiSummary }),
  setEngine: (engine) => set({ engine }),
  setBackendLabel: (backendLabel) => set({ backendLabel }),
  setMatches: (matches) =>
    set((s) => ({
      matches,
      selectedJobIds: s.selectedJobIds.length
        ? s.selectedJobIds.filter((id) => matches.some((m) => m.jobId === id))
        : matches.filter((m) => m.score >= s.criteria.minScore).map((m) => m.jobId),
    })),
  toggleJob: (id) =>
    set((s) => ({
      selectedJobIds: s.selectedJobIds.includes(id)
        ? s.selectedJobIds.filter((x) => x !== id)
        : [...s.selectedJobIds, id],
    })),
  setSelectedJobIds: (selectedJobIds) => set({ selectedJobIds }),
  setCriteria: (patch) => set((s) => ({ criteria: { ...s.criteria, ...patch } })),
  setPhase: (phase) => set({ phase }),
  setActiveAppId: (activeAppId) => set({ activeAppId }),
  setBusyExtracting: (busyExtracting) => set({ busyExtracting }),

  addApplication: (app) => set((s) => ({ applications: [app, ...s.applications] })),
  patchApplication: (id, patch) =>
    set((s) => ({
      applications: s.applications.map((a) =>
        a.id === id ? { ...a, ...patch, updatedAt: Date.now() } : a,
      ),
    })),
  patchStep: (appId, stepId, patch) =>
    set((s) => ({
      applications: s.applications.map((a) =>
        a.id === appId
          ? {
              ...a,
              updatedAt: Date.now(),
              steps: a.steps.map((st) => (st.id === stepId ? { ...st, ...patch } : st)),
            }
          : a,
      ),
    })),
  pushStep: (appId, step) =>
    set((s) => ({
      applications: s.applications.map((a) =>
        a.id === appId ? { ...a, steps: [...a.steps, step], updatedAt: Date.now() } : a,
      ),
    })),

  addPending: (t) =>
    set((s) => (s.pending.some((p) => p.id === t.id) ? s : { pending: [...s.pending, t] })),
  resolvePending: (id) => set((s) => ({ pending: s.pending.filter((p) => p.id !== id) })),

  log: (level, text, appId) =>
    set((s) => ({
      logs: [
        ...s.logs.slice(-400),
        { id: `l-${logSeq++}`, ts: Date.now(), level, text, appId },
      ],
    })),
  clearLogs: () => set({ logs: [] }),
  resetRun: () => {
    logSeq = 0;
    set({ applications: [], pending: [], logs: [], phase: 'idle', activeAppId: null });
  },
}));

export type { Job, JobMatch, Application, PendingTask, LogEntry, EngineStatus };
