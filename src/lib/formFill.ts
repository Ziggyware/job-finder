import type { ResumeProfile } from '../types';

/** Values we are willing to drop into a real application form. Sensitive
 * answers (work auth, salary, criminal, EEO) are never included. */
export interface FillPayload {
  firstName: string;
  middleName: string;
  lastName: string;
  fullName: string;
  email: string;
  phone: string;
  phoneDigits: string;
  location: string;
  city: string;
  state: string;
  postal: string;
  country: string;
  street: string;
  linkedin: string;
  github: string;
  website: string;
  twitter: string;
  years: string;
  headline: string;
  currentTitle: string;
  currentCompany: string;
  school: string;
  degree: string;
  skills: string;
  summary: string;
}

export interface FieldHint {
  name?: string;
  id?: string;
  placeholder?: string;
  label?: string;
  type?: string;
  autocomplete?: string;
  tag?: string;
  testId?: string;
  automationId?: string;
  className?: string;
}

export type FillKey = keyof FillPayload;

interface Rule {
  key: FillKey;
  weight: number;
  autocomplete?: string[];
  types?: string[];
  /** Regex sources, already lowercased haystack. */
  patterns: string[];
}

/** Ordered: higher weight wins when several rules fire. */
export const FILL_RULES: Rule[] = [
  {
    key: 'firstName',
    weight: 100,
    autocomplete: ['given-name'],
    patterns: [
      'first[_\\s-]*name',
      'given[_\\s-]*name',
      '\\bfname\\b',
      'firstname',
      'preferred[_\\s-]*name',
      'legal[_\\s-]*first',
      'candidate\\[first',
      'job_application\\[first',
      'applicant\\[first',
      'firstName',
      'first-name',
      'name\\.first',
      'legalnamesection[_\\s-]*firstname',
      'data-automation-id.{0,40}firstname',
    ],
  },
  {
    key: 'middleName',
    weight: 95,
    autocomplete: ['additional-name'],
    patterns: ['middle[_\\s-]*name', '\\bmname\\b', 'middleName', 'name\\.middle'],
  },
  {
    key: 'lastName',
    weight: 100,
    autocomplete: ['family-name'],
    patterns: [
      'last[_\\s-]*name',
      'family[_\\s-]*name',
      'surname',
      '\\blname\\b',
      'lastname',
      'legal[_\\s-]*last',
      'candidate\\[last',
      'job_application\\[last',
      'applicant\\[last',
      'lastName',
      'last-name',
      'name\\.last',
      'legalnamesection[_\\s-]*lastname',
    ],
  },
  {
    key: 'email',
    weight: 110,
    autocomplete: ['email'],
    types: ['email'],
    patterns: [
      '\\bemail\\b',
      'e-mail',
      'e_mail',
      'mailaddress',
      'candidate\\[email',
      'job_application\\[email',
      'applicant\\.email',
    ],
  },
  {
    key: 'phone',
    weight: 100,
    autocomplete: ['tel', 'tel-national'],
    types: ['tel'],
    patterns: [
      '\\bphone\\b',
      'phone[_\\s-]*number',
      'mobile',
      '\\bcell\\b',
      '\\btel\\b',
      'telephone',
      'candidate\\[phone',
      'job_application\\[phone',
      'phoneNumber',
      'phonenumber',
    ],
  },
  {
    key: 'linkedin',
    weight: 90,
    patterns: ['linkedin', 'urls\\[linkedin', 'social.*linkedin', 'profile[_\\s-]*url'],
  },
  {
    key: 'github',
    weight: 90,
    patterns: ['github', 'git[_\\s-]*hub', 'urls\\[github', 'gitlab'],
  },
  {
    key: 'twitter',
    weight: 80,
    patterns: ['twitter', '\\bx\\.com\\b', 'urls\\[twitter'],
  },
  {
    key: 'website',
    weight: 80,
    patterns: [
      'portfolio',
      'website',
      'personal[_\\s-]*site',
      'homepage',
      'personal[_\\s-]*url',
      'urls\\[portfolio',
      'urls\\[other',
      'web[_\\s-]*page',
    ],
  },
  {
    key: 'street',
    weight: 70,
    autocomplete: ['street-address', 'address-line1'],
    patterns: ['street[_\\s-]*address', 'address[_\\s-]*line[_\\s-]*1', 'addr1', 'address1'],
  },
  {
    key: 'city',
    weight: 85,
    autocomplete: ['address-level2'],
    patterns: ['\\bcity\\b', '\\btown\\b', 'locality', 'address-level2', 'municipality'],
  },
  {
    key: 'state',
    weight: 85,
    autocomplete: ['address-level1'],
    patterns: [
      '\\bstate\\b',
      'province',
      'region',
      'address-level1',
      'state[_\\s-]*code',
      'statecode',
    ],
  },
  {
    key: 'postal',
    weight: 85,
    autocomplete: ['postal-code'],
    patterns: ['zip[_\\s-]*code', '\\bzip\\b', 'postal', 'post[_\\s-]*code', 'postcode'],
  },
  {
    key: 'country',
    weight: 80,
    autocomplete: ['country', 'country-name'],
    patterns: ['\\bcountry\\b', 'nation', 'country[_\\s-]*code'],
  },
  {
    key: 'location',
    weight: 60,
    patterns: [
      '\\blocation\\b',
      'current[_\\s-]*location',
      'city and country',
      'where do you live',
      'based in',
      'job_application\\[location',
    ],
  },
  {
    key: 'years',
    weight: 75,
    patterns: [
      'years of (relevant |professional |total )?experience',
      'years[_\\s-]*exp',
      'yearsofexperience',
      'total[_\\s-]*years',
      'yoe\\b',
    ],
  },
  {
    key: 'currentTitle',
    weight: 70,
    patterns: [
      'current[_\\s-]*title',
      'job[_\\s-]*title',
      'recent[_\\s-]*title',
      'position[_\\s-]*title',
      'headline',
    ],
  },
  {
    key: 'headline',
    weight: 55,
    patterns: ['professional[_\\s-]*headline', '\\bheadline\\b'],
  },
  {
    key: 'currentCompany',
    weight: 70,
    patterns: [
      'current[_\\s-]*company',
      'current[_\\s-]*employer',
      'most[_\\s-]*recent[_\\s-]*employer',
      'company[_\\s-]*name',
      '\\borg\\b',
      'organization',
    ],
  },
  {
    key: 'school',
    weight: 65,
    patterns: ['\\bschool\\b', 'university', 'college', 'institution', 'education[_\\s-]*name'],
  },
  {
    key: 'degree',
    weight: 65,
    patterns: ['\\bdegree\\b', 'qualification', 'field of study', 'major'],
  },
  {
    key: 'skills',
    weight: 50,
    patterns: ['\\bskills\\b', 'key[_\\s-]*skills', 'technical[_\\s-]*skills'],
  },
  {
    key: 'fullName',
    weight: 50,
    autocomplete: ['name'],
    patterns: ['full[_\\s-]*name', '\\bname\\b', 'applicant[_\\s-]*name', 'legal[_\\s-]*name', 'candidate\\[name'],
  },
  {
    key: 'summary',
    weight: 45,
    patterns: [
      'cover[_\\s-]*letter',
      'why (do you want|this role|are you interested)',
      'additional[_\\s-]*(information|comments|notes)',
      '\\bcomments\\b',
      'message to hiring',
      'tell us about',
      '\\bsummary\\b',
      'about[_\\s-]*you',
    ],
  },
];

export const SKIP_RE =
  /\b(password|passcode|ssn|social security|national id|nationalid|nationality|nin\b|salary|compensation|pay expectation|desired pay|expected pay|sponsor|visa|authoris|authoriz|work permit|citizenship|citizen|gender|sex\b|race|ethnicity|hispanic|veteran|disability|disabled|criminal|conviction|felony|eeo|equal opportunity|self-identify|self identify|pronoun|date of birth|birthdate|dob\b|age\b|captcha|recaptcha|hcaptcha|security question|mother'?s maiden)\b/i;

/** Extra ATS / i18n / spoken-label patterns merged at match time. */
export const EXTRA_PATTERNS: Partial<Record<FillKey, string[]>> = {
  firstName: [
    'prenom',
    'prénom',
    'vorname',
    'nombre(?! de usuario)',
    'what is your first',
    'wd-firstname',
    'legalname.*first',
    'icims.*first',
    'confirm.?first',
  ],
  lastName: [
    'apellido',
    'nachname',
    'nom de famille',
    'what is your last',
    'wd-lastname',
    'familyname',
    'icims.*last',
  ],
  email: [
    'correo',
    'e-mail',
    'mailadresse',
    'confirm.?e-?mail',
    're-?enter.?e-?mail',
    'email.?address',
    'wd-email',
    'what.{0,12}email',
  ],
  phone: [
    'telefono',
    'teléfono',
    'telefon',
    'handy',
    'whatsapp',
    'sms',
    'best.?number',
    'contact.?number',
    'wd-phone',
    'phone.?country',
  ],
  linkedin: ['li\\.com', 'linkedin\\.com', 'linkedin url', 'linkedin profile'],
  github: ['github\\.com', 'gitlab\\.com', 'bitbucket'],
  website: ['personal website', 'online portfolio', 'behance', 'dribbble'],
  city: ['ciudad', 'ville', 'stadt', 'municipio'],
  state: ['estado', 'bundesland', 'région', 'county'],
  postal: ['codigo postal', 'código postal', 'plz', 'cap\\b'],
  country: ['país', 'pays', 'land$', 'nationality'], // nationality still skipped by SKIP if "citizen"
  location: ['where are you (based|located)', 'timezone', 'time zone', 'metro area'],
  years: ['how many years', 'experience \\(years', 'yrs experience', 'yoe'],
  currentTitle: ['role title', 'position', 'designation', 'job role'],
  currentCompany: ['employer', 'organisation', 'organization', 'firma', 'empresa', 'where do you work'],
  school: ['alma mater', 'graduated from', 'universidad', 'hochschule'],
  degree: ['bachelors', "bachelor's", 'masters', "master's", 'phd', 'diploma', 'field of study'],
  skills: ['competencies', 'tech stack', 'technologies', 'herramientas'],
  fullName: ['your name', 'nombre completo', 'vollständiger name', 'legal name'],
  summary: [
    'motivation letter',
    'letter of interest',
    'why us',
    'why this company',
    'anything else',
    'other information',
    'pitch',
  ],
};

const BAGS: Record<FillKey, string[]> = {
  firstName: ['first', 'given', 'prenom', 'vorname', 'fname'],
  middleName: ['middle', 'second'],
  lastName: ['last', 'family', 'surname', 'apellido', 'nachname', 'lname'],
  fullName: ['fullname', 'legalname', 'yourname'],
  email: ['email', 'e-mail', 'mail', 'correo'],
  phone: ['phone', 'mobile', 'cell', 'tel', 'telefono', 'telefon'],
  phoneDigits: [],
  location: ['location', 'based', 'timezone'],
  city: ['city', 'town', 'ville', 'ciudad', 'stadt'],
  state: ['state', 'province', 'region', 'estado'],
  postal: ['zip', 'postal', 'postcode', 'plz'],
  country: ['country', 'nation', 'pais', 'país', 'pays'],
  street: ['street', 'address1', 'addr'],
  linkedin: ['linkedin'],
  github: ['github', 'gitlab'],
  website: ['portfolio', 'website', 'homepage'],
  twitter: ['twitter'],
  years: ['years', 'yoe', 'experience'],
  headline: ['headline'],
  currentTitle: ['title', 'position', 'designation', 'role'],
  currentCompany: ['company', 'employer', 'organisation', 'organization', 'firma'],
  school: ['school', 'university', 'college', 'universidad'],
  degree: ['degree', 'bachelor', 'master', 'major', 'diploma'],
  skills: ['skills', 'stack', 'competencies'],
  summary: ['cover', 'letter', 'motivation', 'summary', 'comments', 'additional'],
};

function compile(src: string): RegExp {
  return new RegExp(src, 'i');
}

export function haystack(f: FieldHint): string {
  const raw = [f.name, f.id, f.placeholder, f.label, f.autocomplete, f.type, f.tag, f.testId, f.automationId, f.className]
    .filter(Boolean)
    .join(' ');
  const spaced = raw
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[/#._[\]]+/g, ' ')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return `${spaced} ${spaced.replace(/ /g, '')}`;
}

function tokens(h: string): Set<string> {
  return new Set(h.split(/[^a-z0-9+]+/i).filter((t) => t.length > 1));
}

function bagScore(key: FillKey, h: string): number {
  const bag = BAGS[key];
  if (!bag?.length) return 0;
  const t = tokens(h);
  let n = 0;
  for (const w of bag) if (t.has(w) || h.includes(w)) n++;
  if (n === 0) return 0;
  if (n === 1 && bag.length > 3) return 8;
  return n * 18;
}

export function matchFillKey(f: FieldHint): FillKey | null {
  return matchFill(f)?.key ?? null;
}

export function matchFill(f: FieldHint): { key: FillKey; score: number } | null {
  const h = haystack(f);
  if (SKIP_RE.test(h)) return null;
  if (f.type === 'password' || f.type === 'hidden' || f.type === 'file') return null;

  let best: { key: FillKey; score: number } | null = null;
  for (const rule of FILL_RULES) {
    let score = 0;
    if (f.autocomplete && rule.autocomplete?.includes(f.autocomplete)) score += rule.weight + 20;
    if (f.type && rule.types?.includes(f.type)) score += rule.weight + 15;
    const extras = EXTRA_PATTERNS[rule.key] || [];
    const pats = rule.patterns.concat(extras);
    for (const p of pats) {
      if (compile(p).test(h)) {
        score += rule.weight;
        break;
      }
    }
    score += bagScore(rule.key, h);
    if (score > 0 && (!best || score > best.score)) best = { key: rule.key, score };
  }
  if (best && best.score < 24) return null;

  // A generic "name" must not beat first/last when those also matched on the same field —
  // already handled by weights. Guard: "user name" / username is login, skip.
  if (best?.key === 'fullName' && /\buser[\s_-]*name\b|\busername\b|\blogin\b/.test(h)) return null;
  // Don't dump the cover letter into every textarea; require a summary-ish label.
  if (best?.key === 'summary' && f.tag !== 'textarea' && f.type !== 'textarea') {
    if (!/cover|why |additional|comment|summary|about you|message/i.test(h)) return null;
  }
  return best;
}

const US_STATES: Record<string, string> = {
  al: 'AL', ak: 'AK', az: 'AZ', ar: 'AR', ca: 'CA', co: 'CO', ct: 'CT', de: 'DE', fl: 'FL', ga: 'GA',
  hi: 'HI', id: 'ID', il: 'IL', in: 'IN', ia: 'IA', ks: 'KS', ky: 'KY', la: 'LA', me: 'ME', md: 'MD',
  ma: 'MA', mi: 'MI', mn: 'MN', ms: 'MS', mo: 'MO', mt: 'MT', ne: 'NE', nv: 'NV', nh: 'NH', nj: 'NJ',
  nm: 'NM', ny: 'NY', nc: 'NC', nd: 'ND', oh: 'OH', ok: 'OK', or: 'OR', pa: 'PA', ri: 'RI', sc: 'SC',
  sd: 'SD', tn: 'TN', tx: 'TX', ut: 'UT', vt: 'VT', va: 'VA', wa: 'WA', wv: 'WV', wi: 'WI', wy: 'WY',
  dc: 'DC',
};

function parseLocation(location: string): { city: string; state: string; postal: string; country: string } {
  const loc = location.trim();
  const zip = loc.match(/\b(\d{5})(?:-\d{4})?\b/);
  const postal = zip?.[1] || '';
  const stateMatch = loc.match(/,\s*([A-Za-z]{2})\b/) || loc.match(/\b([A-Za-z]{2})\s+\d{5}/);
  let state = '';
  if (stateMatch) {
    const code = stateMatch[1].toLowerCase();
    state = US_STATES[code] || stateMatch[1].toUpperCase();
  } else {
    for (const [k, v] of Object.entries(US_STATES)) {
      if (new RegExp(`\\b${k}\\b`, 'i').test(loc) && k.length > 2) {
        state = v;
        break;
      }
    }
  }
  const city = loc.split(',')[0]?.replace(/\d{5}(?:-\d{4})?/, '').trim() || loc;
  const country = /\b(uk|united kingdom|england)\b/i.test(loc)
    ? 'United Kingdom'
    : /\bcanada\b/i.test(loc)
      ? 'Canada'
      : state
        ? 'United States'
        : '';
  return { city, state, postal, country };
}

function digits(phone: string): string {
  return phone.replace(/\D+/g, '');
}

function formatPhone(phone: string): string {
  const d = digits(phone);
  if (d.length === 11 && d.startsWith('1')) return `+1 ${d.slice(1, 4)}-${d.slice(4, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  return phone;
}

export function payloadFromProfile(profile: ResumeProfile): FillPayload {
  const bits = profile.name.trim().split(/\s+/);
  const firstName = bits[0] || '';
  const lastName = bits.length > 1 ? bits[bits.length - 1] : '';
  const middleName = bits.length > 2 ? bits.slice(1, -1).join(' ') : '';
  const links = profile.links || [];
  const find = (re: RegExp) => links.find((l) => re.test(l)) || '';
  const linkedin = find(/linkedin/i);
  const github = find(/github|gitlab/i);
  const twitter = find(/twitter|x\.com/i);
  const website = links.find((l) => !/linkedin|github|gitlab|twitter|x\.com|mailto/i.test(l)) || '';
  const loc = parseLocation(profile.location || '');
  const exp0 = profile.experience[0];
  const edu0 = profile.education[0];
  return {
    firstName,
    middleName,
    lastName,
    fullName: profile.name,
    email: profile.email,
    phone: formatPhone(profile.phone || ''),
    phoneDigits: digits(profile.phone || ''),
    location: profile.location,
    city: loc.city,
    state: loc.state,
    postal: loc.postal,
    country: loc.country,
    street: '',
    linkedin,
    github,
    website,
    twitter,
    years: profile.yearsExperience ? String(profile.yearsExperience) : '',
    headline: profile.titles[0] || '',
    currentTitle: exp0?.title || profile.titles[0] || '',
    currentCompany: exp0?.company || '',
    school: edu0?.school || '',
    degree: edu0?.degree || '',
    skills: profile.skills.slice(0, 16).join(', '),
    summary: (profile.summary || '').replace(/\s+/g, ' ').trim().slice(0, 2000),
  };
}

export function plannedFills(fields: FieldHint[], payload: FillPayload): { key: FillKey; value: string }[] {
  const out: { key: FillKey; value: string }[] = [];
  for (const f of fields) {
    const hit = matchFill(f);
    if (!hit) continue;
    const value = valueFor(payload, hit.key, f);
    if (!value) continue;
    out.push({ key: hit.key, value });
  }
  return out;
}

export function valueFor(payload: FillPayload, key: FillKey, field?: FieldHint): string {
  if (key === 'phone' && field?.type === 'tel') return payload.phoneDigits || payload.phone;
  return payload[key] || '';
}

export function pickSelectOption(
  options: string[],
  key: FillKey,
  payload: FillPayload,
): string | null {
  const want = valueFor(payload, key).toLowerCase();
  if (!want) return null;
  const exact = options.find((o) => o.toLowerCase() === want);
  if (exact) return exact;
  const contains = options.find((o) => o.toLowerCase().includes(want) || want.includes(o.toLowerCase()));
  return contains || null;
}

/** Full IIFE used as a console snippet (can be longer than a bookmarklet). */
export function fillRuntimeSource(payload: FillPayload): string {
  const json = JSON.stringify(payload);
  const rules = JSON.stringify(
    FILL_RULES.map((r) => ({
      k: r.key,
      w: r.weight,
      a: r.autocomplete || [],
      t: r.types || [],
      p: r.patterns.concat(EXTRA_PATTERNS[r.key] || []),
    })),
  );
  return `(()=>{
var P=${json};
var RULES=${rules};
var SKIP=/${SKIP_RE.source}/i;
function hay(el){
  var lab='';
  try{ if(el.labels&&el.labels[0]) lab=el.labels[0].innerText; }catch(e){}
  if(!lab && el.id){
    var l2=document.querySelector('label[for="'+CSS.escape(el.id)+'"]');
    if(l2) lab=l2.innerText;
  }
  var wrap=el.closest('label,.field,.form-group,.application-field,.input,div');
  if(wrap && wrap!==el) lab += ' '+(wrap.innerText||'').slice(0,180);
  return [el.name,el.id,el.placeholder,el.getAttribute('aria-label'),el.getAttribute('autocomplete'),el.type,el.tagName,el.getAttribute('data-testid'),el.getAttribute('data-test'),el.getAttribute('data-qa'),el.getAttribute('data-automation-id'),el.className,lab].join(' ').toLowerCase();
}
function nativeSet(el,v){
  var proto = el.tagName==='TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  var desc = Object.getOwnPropertyDescriptor(proto,'value');
  el.focus();
  if(desc && desc.set) desc.set.call(el,v); else el.value=v;
  el.dispatchEvent(new Event('input',{bubbles:true}));
  el.dispatchEvent(new InputEvent('input',{bubbles:true,data:v,inputType:'insertText'}));
  el.dispatchEvent(new Event('change',{bubbles:true}));
  el.dispatchEvent(new Event('blur',{bubbles:true}));
}
function classify(h, type, tag){
  if(SKIP.test(h)) return null;
  var best=null, bestS=0;
  for(var i=0;i<RULES.length;i++){
    var r=RULES[i], s=0;
    if(r.a.indexOf((type==='email'?'email':''))>=0) {}
    var ac='';
    for(var j=0;j<r.p.length;j++){
      try{ if(new RegExp(r.p[j],'i').test(h)){ s+=r.w; break; } }catch(e){}
    }
    if(r.t.indexOf(type)>=0) s+=r.w+15;
    if(s>bestS){ bestS=s; best=r.k; }
  }
  if(best==='fullName' && /user[\\s_-]*name|username|login/.test(h)) return null;
  if(best==='summary' && tag!=='TEXTAREA' && type!=='textarea' && !/cover|why |additional|comment|summary|about you|message/.test(h)) return null;
  return best;
}
function val(k, el){
  if(k==='phone' && el && el.type==='tel') return P.phoneDigits||P.phone;
  return P[k]||'';
}
function walkRoot(root, acc){
  var nodes;
  try{ nodes=root.querySelectorAll('input,textarea,select,[contenteditable="true"]'); }
  catch(e){ return acc; }
  for(var i=0;i<nodes.length;i++) acc.push(nodes[i]);
  var all;
  try{ all=root.querySelectorAll('*'); }catch(e){ return acc; }
  for(var j=0;j<all.length;j++){
    if(all[j].shadowRoot) walkRoot(all[j].shadowRoot, acc);
  }
  return acc;
}
function docsFrom(win){
  var out=[win.document];
  var ifr=win.document.querySelectorAll('iframe');
  for(var i=0;i<ifr.length;i++){
    try{
      if(ifr[i].contentWindow && ifr[i].contentDocument) out=out.concat(docsFrom(ifr[i].contentWindow));
    }catch(e){}
  }
  return out;
}
var filled=0, skipped=0, names=[];
var seen={};
var docs=docsFrom(window);
for(var d=0;d<docs.length;d++){
  var els=walkRoot(docs[d], []);
  for(var i=0;i<els.length;i++){
    var el=els[i];
    if(el.disabled || el.readOnly) { skipped++; continue; }
    var type=(el.type||'').toLowerCase();
    if(type==='hidden'||type==='password'||type==='file'||type==='submit'||type==='button'||type==='checkbox'||type==='radio'||type==='image') continue;
    var h=hay(el);
    var k=classify(h, type, el.tagName);
    if(!k) continue;
    var v=val(k, el);
    if(!v) continue;
    if(el.tagName==='SELECT'){
      var opts=[].map.call(el.options,function(o){return o.text;});
      var want=v.toLowerCase();
      var hit=null;
      for(var o=0;o<el.options.length;o++){
        var t=el.options[o].text.toLowerCase();
        var ov=(el.options[o].value||'').toLowerCase();
        if(t===want||ov===want||t.indexOf(want)>=0||want.indexOf(t)>=0&&t.length>1){ hit=el.options[o]; break; }
      }
      if(hit){ el.value=hit.value; el.dispatchEvent(new Event('change',{bubbles:true})); filled++; names.push(k); }
      continue;
    }
    if(el.isContentEditable){
      el.focus(); el.innerText=v;
      el.dispatchEvent(new Event('input',{bubbles:true}));
      filled++; names.push(k); continue;
    }
    nativeSet(el,v);
    filled++; names.push(k);
  }
}
var uniq=[];
names.forEach(function(n){ if(uniq.indexOf(n)<0) uniq.push(n); });
var msg='JobPilot filled '+filled+' control'+(filled===1?'':'s')+' ('+uniq.join(', ')+'). Review every field, then submit yourself.';
try{ console.info(msg); }catch(e){}
alert(msg);
})();`;
}

export function bookmarkletHref(payload: FillPayload): string {
  // Bookmarklets choke on whitespace; minify lightly.
  const src = fillRuntimeSource(payload).replace(/\s+/g, ' ');
  return 'javascript:' + encodeURIComponent(src);
}

export function consoleScript(payload: FillPayload): string {
  return fillRuntimeSource(payload);
}

export function userscriptSource(payload: FillPayload): string {
  return `// ==UserScript==
// @name         JobPilot Fill
// @namespace    jobpilot
// @version      1.0
// @description  Fill job application fields from your JobPilot resume. Review, then submit yourself.
// @match        *://*/*
// @grant        none
// ==/UserScript==

(function () {
  if (window.top !== window) return;
  if (document.getElementById('jobpilot-fill-btn')) return;
  var menu = document.createElement('button');
  menu.id = 'jobpilot-fill-btn';
  menu.textContent = 'JobPilot Fill';
  menu.setAttribute('style', 'position:fixed;z-index:2147483647;right:16px;bottom:16px;padding:10px 14px;font:600 14px system-ui;background:#ffb020;color:#201400;border:0;border-radius:10px;cursor:pointer;box-shadow:0 8px 24px rgba(0,0,0,.35)');
  menu.addEventListener('click', function () {
    ${fillRuntimeSource(payload)}
  });
  document.documentElement.appendChild(menu);
})();
`;
}

export function downloadUserscript(payload: FillPayload) {
  const blob = new Blob([userscriptSource(payload)], { type: 'text/javascript' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'jobpilot-fill.user.js';
  a.click();
  URL.revokeObjectURL(url);
}
