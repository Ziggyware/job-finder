import { create } from 'zustand';
import type { EngineStatus, LogEntry, ResumeProfile } from './types';

export type TrackStatus = 'saved' | 'applied' | 'interview' | 'offer' | 'rejected';

export interface TrackedRole {
  id: string;
  url: string;
  title: string;
  company: string;
  status: TrackStatus;
  notes: string;
  addedAt: number;
}

interface PersistShape {
  profile: ResumeProfile | null;
  profileFile: string | null;
  aiSummary: string;
  tracked: TrackedRole[];
}

const KEY = 'jobpilot-v1';

function loadPersist(): PersistShape {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { profile: null, profileFile: null, aiSummary: '', tracked: [] };
    const p = JSON.parse(raw) as PersistShape;
    return {
      profile: p.profile ?? null,
      profileFile: p.profileFile ?? null,
      aiSummary: p.aiSummary ?? '',
      tracked: Array.isArray(p.tracked) ? p.tracked : [],
    };
  } catch {
    return { profile: null, profileFile: null, aiSummary: '', tracked: [] };
  }
}

function savePersist(s: PersistShape) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* quota */
  }
}

interface State {
  profile: ResumeProfile | null;
  profileFile: string | null;
  aiSummary: string;
  engine: EngineStatus;
  logs: LogEntry[];
  busyExtracting: boolean;
  tracked: TrackedRole[];

  setProfile: (p: ResumeProfile | null, file: string | null) => void;
  setAiSummary: (s: string) => void;
  setEngine: (s: EngineStatus) => void;
  setBusyExtracting: (b: boolean) => void;
  log: (level: LogEntry['level'], text: string) => void;
  addTracked: (t: Omit<TrackedRole, 'id' | 'addedAt'>) => void;
  patchTracked: (id: string, patch: Partial<TrackedRole>) => void;
  removeTracked: (id: string) => void;
}

let logSeq = 0;
const boot = loadPersist();

export const useStore = create<State>((set, get) => ({
  profile: boot.profile,
  profileFile: boot.profileFile,
  aiSummary: boot.aiSummary,
  engine: {
    state: 'idle',
    backend: 'webllm',
    modelId: '',
    progress: 0,
    progressText: 'Not started',
  },
  logs: [],
  busyExtracting: false,
  tracked: boot.tracked,

  setProfile: (profile, file) => {
    set({ profile, profileFile: file });
    const s = get();
    savePersist({ profile, profileFile: file, aiSummary: s.aiSummary, tracked: s.tracked });
  },
  setAiSummary: (aiSummary) => {
    set({ aiSummary });
    const s = get();
    savePersist({ profile: s.profile, profileFile: s.profileFile, aiSummary, tracked: s.tracked });
  },
  setEngine: (engine) => set({ engine }),
  setBusyExtracting: (busyExtracting) => set({ busyExtracting }),
  log: (level, text) =>
    set((s) => ({
      logs: [...s.logs.slice(-200), { id: `l-${logSeq++}`, ts: Date.now(), level, text }],
    })),
  addTracked: (t) => {
    const row: TrackedRole = { ...t, id: `t-${Date.now().toString(36)}`, addedAt: Date.now() };
    set((s) => {
      const tracked = [row, ...s.tracked];
      savePersist({ profile: s.profile, profileFile: s.profileFile, aiSummary: s.aiSummary, tracked });
      return { tracked };
    });
  },
  patchTracked: (id, patch) => {
    set((s) => {
      const tracked = s.tracked.map((x) => (x.id === id ? { ...x, ...patch } : x));
      savePersist({ profile: s.profile, profileFile: s.profileFile, aiSummary: s.aiSummary, tracked });
      return { tracked };
    });
  },
  removeTracked: (id) => {
    set((s) => {
      const tracked = s.tracked.filter((x) => x.id !== id);
      savePersist({ profile: s.profile, profileFile: s.profileFile, aiSummary: s.aiSummary, tracked });
      return { tracked };
    });
  },
}));
