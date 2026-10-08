/** Deep-link builders for major job boards. Boards do not expose a CORS-safe
 * public search API, so we open their real search pages with the user's query. */

export interface BoardLink {
  id: string;
  name: string;
  blurb: string;
  url: string;
}

export interface BoardQuery {
  keywords: string;
  location: string;
  remote: boolean;
}

export function defaultQueryFromProfile(profile: {
  titles: string[];
  skills: string[];
  location: string;
}): BoardQuery {
  const title = profile.titles[0] || profile.skills.slice(0, 3).join(' ') || 'software engineer';
  return {
    keywords: title,
    location: profile.location || '',
    remote: false,
  };
}

function q(s: string) {
  return encodeURIComponent(s.trim());
}

function locPart(location: string, remote: boolean) {
  if (remote) return ' Remote';
  return location ? ` ${location}` : '';
}

export function boardLinks(query: BoardQuery): BoardLink[] {
  const k = query.keywords.trim() || 'software engineer';
  const loc = query.location.trim();
  const remote = query.remote;
  const indeedLoc = remote ? 'Remote' : loc || 'United States';
  const linkedInLoc = remote ? 'Remote' : loc;
  const googleQ = `${k}${locPart(loc, remote)} jobs`;

  return [
    {
      id: 'linkedin',
      name: 'LinkedIn',
      blurb: 'Largest professional network · Easy Apply',
      url: `https://www.linkedin.com/jobs/search/?keywords=${q(k)}${linkedInLoc ? `&location=${q(linkedInLoc)}` : ''}${remote ? '&f_WT=2' : ''}`,
    },
    {
      id: 'indeed',
      name: 'Indeed',
      blurb: 'Broad aggregator across employers and agencies',
      url: `https://www.indeed.com/jobs?q=${q(k)}&l=${q(indeedLoc)}`,
    },
    {
      id: 'google',
      name: 'Google Jobs',
      blurb: 'Aggregates LinkedIn, Indeed, company sites',
      url: `https://www.google.com/search?q=${q(googleQ)}&ibp=htl;jobs`,
    },
    {
      id: 'glassdoor',
      name: 'Glassdoor',
      blurb: 'Jobs plus salary and interview intel',
      url: `https://www.glassdoor.com/Job/jobs.htm?sc.keyword=${q(k)}${loc ? `&locT=C&locKeyword=${q(loc)}` : ''}`,
    },
    {
      id: 'ziprecruiter',
      name: 'ZipRecruiter',
      blurb: 'One-click apply across many employers',
      url: `https://www.ziprecruiter.com/jobs-search?search=${q(k)}&location=${q(remote ? 'Remote' : loc)}`,
    },
    {
      id: 'wellfound',
      name: 'Wellfound',
      blurb: 'Startup roles (formerly AngelList Talent)',
      url: `https://wellfound.com/jobs?q=${q(k)}${remote ? '&remote=true' : ''}`,
    },
    {
      id: 'dice',
      name: 'Dice',
      blurb: 'Tech-focused contract and full-time',
      url: `https://www.dice.com/jobs?q=${q(k)}&location=${q(remote ? 'Remote' : loc)}`,
    },
    {
      id: 'monster',
      name: 'Monster',
      blurb: 'Long-running board with employer listings',
      url: `https://www.monster.com/jobs/search?q=${q(k)}&where=${q(remote ? 'Remote' : loc)}`,
    },
    {
      id: 'wwr',
      name: 'We Work Remotely',
      blurb: 'Remote-only, curated',
      url: `https://weworkremotely.com/remote-jobs/search?term=${q(k)}`,
    },
    {
      id: 'remoteok',
      name: 'Remote OK',
      blurb: 'Remote tech roles worldwide',
      url: `https://remoteok.com/remote-${q(k.replace(/\s+/g, '-'))}-jobs`,
    },
    {
      id: 'greenhouse',
      name: 'Greenhouse (via Google)',
      blurb: 'Direct company ATS postings',
      url: `https://www.google.com/search?q=${q(`site:boards.greenhouse.io ${k}${locPart(loc, remote)}`)}`,
    },
    {
      id: 'lever',
      name: 'Lever (via Google)',
      blurb: 'Direct company ATS postings',
      url: `https://www.google.com/search?q=${q(`site:jobs.lever.co ${k}${locPart(loc, remote)}`)}`,
    },
  ];
}

export function openBoard(url: string) {
  window.open(url, '_blank', 'noopener,noreferrer');
}

export function openAllBoards(links: BoardLink[]) {
  for (const b of links.slice(0, 6)) openBoard(b.url);
}
