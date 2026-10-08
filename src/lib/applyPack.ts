import type { Job, ResumeProfile } from '../types';
import { formFieldsFor } from './match';
import { boardLinks } from './jobBoards';

export interface ApplyField {
  label: string;
  value: string;
  copyOnly?: boolean;
}

export interface ApplyPack {
  headline: string;
  fields: ApplyField[];
  coverLetter: string;
  plainText: string;
  boardUrls: { name: string; url: string }[];
}

function draftCover(profile: ResumeProfile, job: Job): string {
  const skills = profile.skills.slice(0, 6).join(', ') || 'the skills on my resume';
  const title = profile.titles[0] || 'software engineer';
  const years = profile.yearsExperience ? `${profile.yearsExperience}+ years` : 'several years';
  return [
    `Dear ${job.company} hiring team,`,
    '',
    `I am applying for ${job.title} in ${job.location}. I am a ${title} with ${years} of experience, and my background in ${skills} maps directly to this posting.`,
    '',
    profile.summary
      ? profile.summary.replace(/\s+/g, ' ').trim()
      : `Recent work includes ${profile.experience[0]?.title || title} at ${profile.experience[0]?.company || 'my current team'}.`,
    '',
    `I would welcome the chance to talk about how I can help ${job.company}. Thank you for your time.`,
    '',
    profile.name,
    profile.email,
    profile.phone,
  ]
    .filter((l) => l !== undefined)
    .join('\n');
}

export function buildApplyPack(profile: ResumeProfile, job: Job): ApplyPack {
  const fields: ApplyField[] = formFieldsFor(job).map((f) => {
    let value = f.prefill || '';
    switch (f.id) {
      case 'full_name':
        value = profile.name;
        break;
      case 'email':
        value = profile.email;
        break;
      case 'phone':
        value = profile.phone;
        break;
      case 'location':
        value = profile.location;
        break;
      case 'links':
        value = profile.links.join(' | ');
        break;
      case 'years_exp':
        value = String(profile.yearsExperience || '');
        break;
      case 'resume_file':
        value = '(attach the PDF you uploaded in JobPilot)';
        break;
      case 'cover_letter':
        value = '';
        break;
      case 'work_auth':
      case 'notice':
      case 'salary':
        value = '(you must answer this — JobPilot will not invent it)';
        break;
      default:
        value = value || '';
    }
    return { label: f.label, value };
  });

  const coverLetter = draftCover(profile, job);
  const coverField = fields.find((f) => f.label.toLowerCase().includes('cover'));
  if (coverField) coverField.value = coverLetter;

  const boards = boardLinks({
    keywords: `${job.title} ${job.company}`,
    location: job.location,
    remote: job.remote === 'remote',
  }).slice(0, 6);

  const lines = [
    `APPLY PACK — ${job.title} at ${job.company}`,
    `${job.location} · ${job.remote} · ${job.salary}`,
    '',
    'Fill these on the employer form. Do not invent work auth, salary, or start date.',
    '',
    ...fields.map((f) => `${f.label}:\n${f.value || '(blank)'}\n`),
  ];

  return {
    headline: `${job.title} · ${job.company}`,
    fields,
    coverLetter,
    plainText: lines.join('\n'),
    boardUrls: boards.map((b) => ({ name: b.name, url: b.url })),
  };
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function downloadText(filename: string, text: string) {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
