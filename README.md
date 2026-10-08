# JobPilot 🛫

**Upload a resume. A free AI — running inside your own browser tab, with no API key and no account — matches you to
jobs, fills in the applications, and drives them to submission. You watch it work the whole time, and it stops and asks
you whenever the correct answer is genuinely yours to give: salary, availability, work authorisation, and the visual
"are you human?" walls.**

Every skill claim, every filled field, every checkpoint and every receipt is written to an audit log you can read line
by line.

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # 37 logic checks: parser, matcher, threat model of the agent loop
npm run test:ui  # 36 UI checks in jsdom, driving the real app through the real widgets
```

---

## The free-AI question, answered honestly

The brief was: *completely free, modern, no API key, and not the obvious free-tier scraping proxies.* So I went looking
for what "free" can actually mean in 2026, and the honest answer is that there are only three shapes of it:

| Shape | Examples | Why it fails the brief |
| --- | --- | --- |
| **Keyless gateway** | Pollinations-style anonymous tiers | Explicitly excluded, and their anonymous tier realistically answers `429` most of the time anyway ([1](https://github.com/ClawLabsAI/free-ai-models)) |
| **Free tier of a hosted API** | Gemini, Groq, Cerebras, OpenRouter `:free`, GitHub Models, Puter.js | All need an account/API key, all have hard rate caps, all read your resume on someone else's server, and most free-tier ToS are scoped to *experimentation* or forbid consumer/proxy use ([2](https://github.com/OliverMoooi/freellmapi)) |
| **Local inference, in the browser** | **WebLLM** (Apache-2.0, MLC AI) + open-weight models | Nothing to meter, nothing to sign up for, nothing to leak. The only "cost" is a one-time model download and the electricity to run it |

**JobPilot is built on the third shape.** [WebLLM](https://github.com/mlc-ai/web-llm) compiles open-weight models
(Llama 3.2, Qwen 2.5/3, SmolLM2, Phi, Mistral, Gemma) to WebGPU kernels and runs them *inside the page*, with an
OpenAI-compatible API. That gives the app:

- **no API key, no account, no signup** — there is nothing to authenticate against;
- **no per-token cost, no rate limit, no quota** — the compute is the user's own GPU;
- **no data leaving the device** — resume PDFs are parsed with pdf.js locally, and prompts never touch a network;
- **works offline** after the first model download (weights are cached in the browser's Cache Storage).

That is what "completely free" has to mean if it is going to be true rather than temporary. The trade-off is real and the
UI states it: the model is small (360M–8B parameters), only works where WebGPU exists, and needs a one-time download of
~380MB–5GB. **If WebGPU is missing, JobPilot does not die — it degrades to a deterministic heuristic engine** and says so
out loud. Matching, field-filling, escalation and submission all still work; only the prose gets templated.

Pick your model in the model panel. Default suggestion is **Llama 3.2 1B q4f16_1 (~879MB)** — the best
quality-per-megabyte for cover letters and form answers.

---

## What it actually does

```
resume.pdf ──► pdf.js ──► profiler ──► matcher ──► ranked postings
                                                     │
                              ┌──────────────────────┘
                              ▼
   for each selected posting:  navigate → parse → score fit → fill 11 fields
                               → answer screening questions → clear anti-bot walls
                               → submit → receipt
```

**Resume intake.** PDF (pdf.js, worker-bundled), DOCX (unzipped with fflate and read from `word/document.xml`), TXT/MD, or
paste. All local. The profiler is deterministic — it normalises ~150 skill aliases (`nodejs` → `Node.js`), infers titles,
sums dated role spans into years of experience, and pulls education. The LLM only *refines* what the profiler found; it
never becomes the thing that stands between you and a result.

**Matching.** Required-skill coverage (62%), nice-to-haves (13%), title overlap (12%), seniority fit (8%), recency (5%) —
computed with no model at all, so scores are stable and explainable. With a model loaded, the pilot writes the rationale
and blends its own 0–100 judgement in at 45/55.

**Applications.** For each selected posting the pilot walks a fixed, observable state machine: parse requirements, score
the fit, fill every field, draft the cover letter *by streaming it into the form so you can watch it type*, answer the
posting's own screening question, clear the portals' anti-bot walls, click submit, record the receipt.

**The guard rails, which are the interesting part:**

1. **It refuses to invent facts.** Work authorisation, notice period, salary expectations and credentials stop the run and
   come to you. The prompt tells the model to answer `NEEDS_HUMAN` on those topics, *and* a keyword check re-catches them
   afterwards, *and* a confidence floor (< 0.55) parks anything shaky. Any answer it drafts for a sensitive question is
   shown to you for confirmation rather than submitted.
2. **It will not spray a doomed application.** Two postings in the exchange carry hard knockouts (a security clearance,
   shipped visionOS/Metal experience). The ATS simulation rejects those on parse; the pilot reports *why* and skips,
   instead of burning the application.
3. **The honest limit: visual CAPTCHAs.** A text LLM in a browser tab cannot see images. So JobPilot does not fake it. It
   escalates: plain "I'm not a robot" ticks are cleared by the agent itself; *language* challenges ("type the number after
   8") are genuinely solved by the local model; distorted-text, image-grid and drag puzzles are handed to you with a real
   canvas-drawn CAPTCHA, a real image grid and a real drag puzzle. Guessing at those is how you get an account flagged,
   and pretending otherwise would be a lie in the product.
4. **You are always in the loop on demand.** Pause, resume, stop, tempo control, a per-task timeout, and optional
   auto-submit-off mode that parks at the final review and waits for you to pull the trigger.

**Ask the pilot.** A chat panel grounded strictly in the run's own state (profile, queue, applications, pending tasks,
recent log). With a model it's a normal local conversation; without one it still answers the factual questions
("how many went out?", "what's blocked?") from the store rather than telling you to download 600MB.

---

## Architecture

```
src/
  ai/
    engine.ts        WebLLM wrapper: worker-first with main-thread fallback, serialised
                     generation queue, tolerant JSON repair for small-model output
    model.worker.ts  the inference worker (keeps the watching UI smooth)
    tasks.ts         cover letter, question answering, match refinement, summaries
    humanCheck.ts    the anti-bot challenge catalogue + the ai/agent/human split
    instance.ts      one engine per tab (WebLLM holds GPU memory)
  agent/pilot.ts     the state machine: one application at a time, narrating itself
  lib/
    extractText.ts   PDF/DOCX/TXT extraction, all client-side
    resume.ts        deterministic profiler + skill-alias vocabulary
    match.ts         scoring + the fabricated portal's form schema
  components/        ResumeStage → BriefingStage → RunStage + HumanPanel + AskPilot
  store.ts           zustand store; the pilot writes here, React reads it
scripts/
  selftest.ts        37 headless checks: parser, matcher, JSON repair, the whole
                     pilot loop including pause/resume/stop, with a simulated operator
  uitest.tsx         36 checks driving the real app in jsdom through the real widgets
```

Everything the pilot does goes through `useStore`, so "watching" is not a simulation layer — the UI is rendering the
agent's actual state.

---

## Testing

`npm test` runs the real parser, matcher, JSON-repair and the **entire pilot state machine** in Node with no browser:
four applications are worked end to end, every escalation is answered by a simulated operator, and the run is asserted to
produce receipts, non-empty cover letters, terminal states and a clean audit log. It also proves pause freezes progress
and stop is not laundered into a "completed" run.

`npm run test:ui` builds the app for Node and drives it in **jsdom** the way a person would: click "Try the sample
résumé", watch the briefing appear, start the pilot, then answer each parked prompt through its actual widget — typing
the expected string into the generated text CAPTCHA, clicking the correct tiles in the image grid, filling the
sensitive-field textarea and clicking "Send to pilot". It then checks the board, the receipts, the audit log, the model
panel, the Ask-the-pilot fallback, and pause/resume/stop.

Both suites are green (37 + 36 checks). What they *cannot* cover is the real WebGPU path: model download, token
generation and refusal behaviour are exercised in a browser, not in Node.

---

## Boundaries, stated plainly

- **The job exchange is fictional.** Twenty-two invented postings, invented companies and invented ATS rules, generated
  locally. JobPilot contacts no real employer, job board or ATS, and submits nothing anywhere. The AI, the parsing, the
  matching, the form-filling, the escalation logic and the CAPTCHA interactions are all real — the employer on the other
  end is not.
- **WebGPU is required for the AI.** Chrome/Edge 113+, Safari 26+, Firefox 141+. Elsewhere the app runs in heuristic mode
  (clearly labelled) instead of breaking.
- **Small models say small-model things.** Every factual claim still comes from your resume or from you; the model is
  confined to prose. Sensitive answers prefer your correction over its own draft.

## Stack

Vite 8 · React 19 · TypeScript · Tailwind 4 · zustand · WebLLM 0.2.85 · pdf.js · fflate. No backend, no server, no keys.
