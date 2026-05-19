/**
 * fix-location-display-names.mjs
 *
 * Re-parses every location's display_name from scratch and rewrites it
 * in "City, Full State, Full Country" format.
 *
 * Usage:
 *   node fix-location-display-names.mjs           → dry run
 *   node fix-location-display-names.mjs --apply   → write to DB
 *
 * Requires env vars:
 *   MAIN_DB_URL   — Supabase project URL
 *   MAIN_DB_KEY   — service role key
 */

import { createClient } from '@supabase/supabase-js';
import { US_CITY_STATE } from './us-city-state.js';

const APPLY    = process.argv.includes('--apply');
const MAIN_URL = process.env.MAIN_DB_URL || 'https://osoilvzyyjmrbjsiyrgs.supabase.co';
const MAIN_KEY = process.env.MAIN_DB_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9zb2lsdnp5eWptcmJqc2l5cmdzIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDE1NTgwOCwiZXhwIjoyMDg5NzMxODA4fQ.CRdcA7hoSV9CMuFVOJjWAHZis-zjI99BpwphaX1Xl6w';

const db = createClient(MAIN_URL, MAIN_KEY);

// ── Lookup tables ─────────────────────────────────────────────────────────────

const US_STATES = new Set([
  'AL','AK','AZ','AR','CO','CT','FL','HI','IA','KS','KY','LA','ME','MD',
  'MA','MI','MN','MS','MO','NE','NV','NH','NJ','NM','NY','NC','ND','OH',
  'OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC',
  // Ambiguous ones kept OUT — handled via AMBIGUOUS map below
]);

const US_STATE_NAMES = {
  'alabama':'AL','alaska':'AK','arizona':'AZ','arkansas':'AR','california':'CA',
  'colorado':'CO','connecticut':'CT','delaware':'DE','florida':'FL','georgia':'GA',
  'hawaii':'HI','idaho':'ID','illinois':'IL','indiana':'IN','iowa':'IA','kansas':'KS',
  'kentucky':'KY','louisiana':'LA','maine':'ME','maryland':'MD','massachusetts':'MA',
  'michigan':'MI','minnesota':'MN','mississippi':'MS','missouri':'MO','montana':'MT',
  'nebraska':'NE','nevada':'NV','new hampshire':'NH','new jersey':'NJ','new mexico':'NM',
  'new york':'NY','north carolina':'NC','north dakota':'ND','ohio':'OH','oklahoma':'OK',
  'oregon':'OR','pennsylvania':'PA','rhode island':'RI','south carolina':'SC',
  'south dakota':'SD','tennessee':'TN','texas':'TX','utah':'UT','vermont':'VT',
  'virginia':'VA','washington':'WA','west virginia':'WV','wisconsin':'WI','wyoming':'WY',
  'district of columbia':'DC',
};

const US_STATE_FULL = {
  'AL':'Alabama','AK':'Alaska','AZ':'Arizona','AR':'Arkansas','CA':'California',
  'CO':'Colorado','CT':'Connecticut','DE':'Delaware','FL':'Florida','GA':'Georgia',
  'HI':'Hawaii','ID':'Idaho','IL':'Illinois','IN':'Indiana','IA':'Iowa','KS':'Kansas',
  'KY':'Kentucky','LA':'Louisiana','ME':'Maine','MD':'Maryland','MA':'Massachusetts',
  'MI':'Michigan','MN':'Minnesota','MS':'Mississippi','MO':'Missouri','MT':'Montana',
  'NE':'Nebraska','NV':'Nevada','NH':'New Hampshire','NJ':'New Jersey','NM':'New Mexico',
  'NY':'New York','NC':'North Carolina','ND':'North Dakota','OH':'Ohio','OK':'Oklahoma',
  'OR':'Oregon','PA':'Pennsylvania','RI':'Rhode Island','SC':'South Carolina',
  'SD':'South Dakota','TN':'Tennessee','TX':'Texas','UT':'Utah','VT':'Vermont',
  'VA':'Virginia','WA':'Washington','WV':'West Virginia','WI':'Wisconsin','WY':'Wyoming',
  'DC':'District of Columbia',
};

// For ambiguous 2-letter codes (both a US state AND a country code).
// defaultToUS: true  → `cities` lists FOREIGN cities; unknown city → US state
// defaultToUS: false → `cities` lists US cities (small state); unknown city → foreign country
const AMBIGUOUS = {
  CA: { country: 'CA', defaultToUS: true, cities: new Set(['toronto','vancouver','montreal','calgary','ottawa','edmonton','winnipeg','hamilton','kitchener','waterloo','london','halifax','victoria','saskatoon','regina','kelowna','barrie','guelph','abbotsford','surrey','burnaby','richmond','mississauga','brampton','oshawa','lethbridge','red deer','medicine hat','grande prairie','sherwood park','kamloops','prince george','moncton','fredericton','saint john','charlottetown','whitehorse','yellowknife','iqaluit','markham','vaughan','pickering','ajax','newmarket','aurora','richmond hill','oakville','burlington','st catharines','niagara falls','windsor','kingston','sudbury','thunder bay','nanaimo','prince albert']) },
  CO: { country: 'CO', defaultToUS: true, cities: new Set(['bogota','bogotá','medellin','medellín','cali','barranquilla','cartagena','cucuta','cúcuta','bucaramanga','pereira','santa marta','manizales','ibague','ibagué','envigado','bello','itagüi','palmira','armenia','villavicencio','soacha','pasto','neiva','montería','sincelejo','valledupar','tunja','riohacha']) },
  IN: { country: 'IN', defaultToUS: true, cities: new Set(['mumbai','delhi','new delhi','bangalore','bengaluru','hyderabad','ahmedabad','chennai','kolkata','surat','pune','jaipur','lucknow','kanpur','nagpur','visakhapatnam','bhopal','patna','ludhiana','agra','nashik','vadodara','faridabad','meerut','rajkot','noida','gurgaon','gurugram','thane','navi mumbai','kochi','indore','coimbatore','bhubaneswar','chandigarh','mysore','mysuru','trichy','tiruchirappalli','jabalpur','gwalior','vijayawada','jodhpur','raipur','kota','guwahati','thiruvananthapuram','trivandrum','amritsar','ranchi','howrah']) },
  DE: { country: 'DE', defaultToUS: false, cities: new Set(['wilmington','dover','newark','middletown','smyrna','milford','lewes','georgetown','seaford','bridgeville','claymont','bear','elsmere','edgemoor','newark de']) },
  GA: { country: 'GE', defaultToUS: true, cities: new Set(['tbilisi','kutaisi','batumi','rustavi','zugdidi','gori','poti','telavi','akhaltsikhe','ozurgeti','senaki','zestafoni','marneuli']) },
  MT: { country: 'MT', defaultToUS: true, cities: new Set(['valletta','birkirkara','qormi','mosta','zabbar','fgura','zejtun','sliema','st julians','paola','hamrun','swieqi','naxxar','mellieha','rabat','mdina','victoria','san gwann','msida','gzira','marsaskala','marsaxlokk','birgu','senglea']) },
  IL: { country: 'IL', defaultToUS: true, cities: new Set(['tel aviv','jerusalem','haifa','rishon lezion','petah tikva','ashdod','netanya','beer sheva','beersheba','holon','bnei brak','bat yam','rehovot','ashkelon','herzliya','kfar saba','modiin','ramat gan','lod','raanana','ramat hasharon','givatayim','kiryat gat','nazareth','eilat','rishon le-zion','rishon le zion']) },
  ID: { country: 'ID', defaultToUS: true, cities: new Set(['jakarta','surabaya','bandung','bekasi','medan','tangerang','depok','semarang','palembang','makassar','batam','bogor','pekanbaru','bandar lampung','malang','padang','denpasar','samarinda','tasikmalaya','pontianak','balikpapan','cimahi','yogyakarta','mataram','banjarmasin','manado','jayapura','ambon','kupang','kendari','gorontalo','ternate','sorong']) },
};

const COUNTRY_CODES = new Set([
  'us','uk','gb','de','fr','ca','au','in','nl','sg','jp','br','mx','pl','es',
  'it','se','no','dk','fi','ch','be','at','pt','ie','nz','za','ae','tr','il',
  'kr','hk','tw','uz','ua','mt','ph','ng','ke','gh','rw','et','eg','ma','pk',
  'bd','lk','mm','th','vn','id','my','ro','cz','gr','ar','cl','co','pe','ve',
  'ec','gt','cr','pa','do','pr','cu','jm','tt','bo','py','uy','hn','sv','ni',
  'bz','gy','sr','ge','am','az','kz','kg','tj','tm','mn','np','af','ir','iq',
  'sa','jo','lb','sy','ye','om','kw','bh','qa','ly','tn','dz','sd','so','tz',
  'ug','mz','zm','zw','bw','na','mw','mg','ci','cm','sn','ml','bf','ne','td',
  'cg','ao','bi','ls','sz','er','dj','ru','by','md','hu','sk','hr','rs','bg',
  'lt','lv','ee','si','lu','cy','is','cn','kh','la',
]);

const FULL_COUNTRY_NAMES = {
  'united states':'US','united states of america':'US','usa':'US',
  'united kingdom':'GB','great britain':'GB','england':'GB','scotland':'GB','wales':'GB',
  'ukraine':'UA','india':'IN','germany':'DE','france':'FR','canada':'CA','australia':'AU',
  'brazil':'BR','mexico':'MX','spain':'ES','italy':'IT','netherlands':'NL','holland':'NL',
  'singapore':'SG','poland':'PL','sweden':'SE','portugal':'PT','switzerland':'CH',
  'belgium':'BE','austria':'AT','ireland':'IE','denmark':'DK','norway':'NO','finland':'FI',
  'israel':'IL','turkey':'TR','south korea':'KR','korea':'KR','hong kong':'HK','taiwan':'TW',
  'new zealand':'NZ','south africa':'ZA','greece':'GR','romania':'RO','czech republic':'CZ',
  'czechia':'CZ','hungary':'HU','slovakia':'SK','croatia':'HR','serbia':'RS','bulgaria':'BG',
  'lithuania':'LT','latvia':'LV','estonia':'EE','slovenia':'SI','luxembourg':'LU',
  'malta':'MT','cyprus':'CY','iceland':'IS',
  'united arab emirates':'AE','uae':'AE',
  'saudi arabia':'SA','qatar':'QA','kuwait':'KW','bahrain':'BH','oman':'OM',
  'jordan':'JO','lebanon':'LB','egypt':'EG','morocco':'MA','tunisia':'TN','algeria':'DZ',
  'nigeria':'NG','kenya':'KE','ghana':'GH','ethiopia':'ET','tanzania':'TZ','uganda':'UG',
  'zimbabwe':'ZW','zambia':'ZM','mozambique':'MZ','angola':'AO','cameroon':'CM',
  'senegal':'SN','ivory coast':'CI','rwanda':'RW','mali':'ML','burkina faso':'BF',
  'pakistan':'PK','bangladesh':'BD','sri lanka':'LK','nepal':'NP','afghanistan':'AF',
  'myanmar':'MM','burma':'MM','thailand':'TH','vietnam':'VN','viet nam':'VN',
  'indonesia':'ID','malaysia':'MY','philippines':'PH','cambodia':'KH','laos':'LA',
  'china':'CN','japan':'JP','mongolia':'MN',
  'argentina':'AR','chile':'CL','colombia':'CO','peru':'PE','venezuela':'VE',
  'ecuador':'EC','bolivia':'BO','paraguay':'PY','uruguay':'UY',
  'guatemala':'GT','costa rica':'CR','panama':'PA','dominican republic':'DO',
  'puerto rico':'PR','cuba':'CU','jamaica':'JM',
  'uzbekistan':'UZ','kazakhstan':'KZ','georgia':'GE','armenia':'AM','azerbaijan':'AZ',
  'russia':'RU','belarus':'BY','moldova':'MD',
};

const CODE_TO_FULL = {
  'US':'United States','GB':'United Kingdom','DE':'Germany','FR':'France','IN':'India',
  'NL':'Netherlands','SG':'Singapore','JP':'Japan','BR':'Brazil','MX':'Mexico',
  'PL':'Poland','ES':'Spain','IT':'Italy','SE':'Sweden','PT':'Portugal',
  'CH':'Switzerland','BE':'Belgium','AT':'Austria','IE':'Ireland','DK':'Denmark',
  'NO':'Norway','FI':'Finland','IL':'Israel','TR':'Turkey','KR':'South Korea',
  'HK':'Hong Kong','TW':'Taiwan','NZ':'New Zealand','ZA':'South Africa',
  'AE':'UAE','UA':'Ukraine','MT':'Malta','PH':'Philippines','NG':'Nigeria',
  'KE':'Kenya','GH':'Ghana','AU':'Australia','RO':'Romania','CZ':'Czech Republic',
  'GE':'Georgia','PK':'Pakistan','BD':'Bangladesh','TH':'Thailand','VN':'Vietnam',
  'ID':'Indonesia','MY':'Malaysia','EG':'Egypt','MA':'Morocco','ET':'Ethiopia',
  'CA':'Canada','UZ':'Uzbekistan','RW':'Rwanda','LK':'Sri Lanka','MM':'Myanmar',
  'GR':'Greece','HU':'Hungary','SK':'Slovakia','HR':'Croatia','RS':'Serbia',
  'BG':'Bulgaria','LT':'Lithuania','LV':'Latvia','EE':'Estonia','SI':'Slovenia',
  'LU':'Luxembourg','CY':'Cyprus','IS':'Iceland','SA':'Saudi Arabia','QA':'Qatar',
  'KW':'Kuwait','BH':'Bahrain','OM':'Oman','JO':'Jordan','LB':'Lebanon',
  'DZ':'Algeria','TN':'Tunisia','LY':'Libya','TZ':'Tanzania','UG':'Uganda',
  'ZW':'Zimbabwe','ZM':'Zambia','MZ':'Mozambique','AO':'Angola','CM':'Cameroon',
  'SN':'Senegal','CI':'Ivory Coast','ML':'Mali','BF':'Burkina Faso','NP':'Nepal',
  'AF':'Afghanistan','KH':'Cambodia','LA':'Laos','CN':'China','MN':'Mongolia',
  'AR':'Argentina','CL':'Chile','CO':'Colombia','PE':'Peru','VE':'Venezuela',
  'EC':'Ecuador','BO':'Bolivia','PY':'Paraguay','UY':'Uruguay','GT':'Guatemala',
  'CR':'Costa Rica','PA':'Panama','DO':'Dominican Republic','PR':'Puerto Rico',
  'CU':'Cuba','JM':'Jamaica','KZ':'Kazakhstan','AM':'Armenia','AZ':'Azerbaijan',
  'RU':'Russia','BY':'Belarus','MD':'Moldova','TT':'Trinidad and Tobago',
  'HN':'Honduras','SV':'El Salvador','NI':'Nicaragua','BZ':'Belize','GY':'Guyana',
  'SR':'Suriname','KG':'Kyrgyzstan','TJ':'Tajikistan','TM':'Turkmenistan',
  'IR':'Iran','IQ':'Iraq','SY':'Syria','YE':'Yemen','SD':'Sudan','SO':'Somalia',
  'BW':'Botswana','NA':'Namibia','MW':'Malawi','MG':'Madagascar','NE':'Niger',
  'TD':'Chad','CG':'Congo','BI':'Burundi','LS':'Lesotho','SZ':'Eswatini',
  'ER':'Eritrea','DJ':'Djibouti',
};

// ── Core parser (re-parses raw display_name string) ───────────────────────────

function preProcessLocation(raw) {
  let s = raw.trim();
  if (/home.?based/i.test(s)) return 'Remote';

  // Strip trailing zip codes
  s = s.replace(/,?\s*\b\d{5}(?:-\d{4})?\b\s*$/, '').trim();

  // Street address "123 Street Name, City, ST" → extract city after street suffix, or drop first segment
  if (/^\d+\s+\w/.test(s) && s.includes(',')) {
    const parts = s.split(',');
    const firstPart = parts[0];
    // City embedded after suffix: "5600 3rd St. San Francisco" → "San Francisco"
    const afterSuffix = firstPart.match(/\b(?:St\.?|Street|Ave\.?|Avenue|Blvd\.?|Boulevard|Dr\.?|Drive|Rd\.?|Road|Way|Ln\.?|Lane|Ct\.?|Court|Pl\.?|Place|Pkwy\.?|Parkway|Hwy\.?|Highway|Loop|Trl\.?|Trail|NW|NE|SW|SE)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s*$/);
    if (afterSuffix && parts.length > 1) {
      parts[0] = afterSuffix[1];
      s = parts.join(',');
    } else {
      s = parts.slice(1).join(',').trim();
    }
    s = s.replace(/,?\s*\b\d{5}(?:-\d{4})?\b\s*$/, '').trim();
  }

  // Strip work-mode parentheticals: (Hybrid), (Remote), (On-site), etc.
  s = s.replace(/\s*\([^)]*(?:hybrid|remote|on.?site|in\s*office|flex)[^)]*\)/gi, '').trim();
  s = s.replace(/\s+in\s+office.*$/i, '').trim();

  // "[Hybrid/Remote] - City" → "City"
  s = s.replace(/^(?:hybrid|remote|on.?site)\s*[-–]\s*/i, '').trim();

  // "[XX] Office [City]" e.g. "IN Office Bangalore" → "Bangalore, IN"
  const codeOfficeCity = s.match(/^([A-Z]{2})\s+[Oo]ffice\s+(.+)$/);
  if (codeOfficeCity) return codeOfficeCity[2].trim() + ', ' + codeOfficeCity[1];

  // Strip trailing " Office" or " - HQ" suffixes
  s = s.replace(/\s+[Oo]ffice\s*$/, '').trim();
  s = s.replace(/\s*[-–]\s*(?:hq|headquarters|main\s+office|office)\s*$/i, '').trim();

  // Handle "A - B" (SPACES around dash required — avoids splitting hyphenated city names)
  const dashMatch = s.match(/^(.+?)\s+[-–]\s+(.+)$/);
  if (dashMatch) {
    const before   = dashMatch[1].trim();
    const after    = dashMatch[2].trim();
    const beforeLo = before.toLowerCase();
    const looksLikeCountry = FULL_COUNTRY_NAMES[beforeLo] || COUNTRY_CODES.has(beforeLo) ||
      ['uk','usa','us'].includes(beforeLo);

    if (looksLikeCountry) {
      // "Country - City [suffix]"
      let city = after.replace(/\s+[Oo]ffice\s*$/i, '').trim();
      // "City ST" trailing state code → preserve as "City, ST"
      const stateTrail = city.match(/^(.+?)\s+([A-Z]{2})\s*$/);
      if (stateTrail) return stateTrail[1].trim() + ', ' + stateTrail[2] + ', ' + before;
      return city + ', ' + before;
    } else {
      // "City - [office/street descriptor]" → keep only the city
      return before;
    }
  }

  return s;
}

function parseLocation(raw) {
  if (!raw) return null;
  if (/\bremote\b/i.test(raw)) return { display_name: 'Remote', is_remote: true };

  const preprocessed = preProcessLocation(raw);
  if (preprocessed === 'Remote') return { display_name: 'Remote', is_remote: true };

  const cleaned = preprocessed.replace(/,?\s*\[object Object\]/g, '').trim();
  const parts   = cleaned.split(',').map(p => p.trim()).filter(Boolean);

  let city = null, state = null, country = null;

  if (parts.length === 1) {
    const lo = parts[0].toLowerCase();
    if (FULL_COUNTRY_NAMES[lo]) country = FULL_COUNTRY_NAMES[lo];
    else if (COUNTRY_CODES.has(lo)) country = lo === 'uk' ? 'GB' : lo.toUpperCase();
    else if (US_STATES.has(parts[0].toUpperCase())) { state = parts[0].toUpperCase(); country = 'US'; }
    else if (US_STATE_NAMES[lo]) { state = US_STATE_NAMES[lo]; country = 'US'; }
    else city = parts[0];
  } else {
    city = parts[0];
    const second    = parts[1].trim();
    const secondUp  = second.toUpperCase();
    const secondLo  = second.toLowerCase();

    if (parts.length >= 3) {
      // "City, State, Country"
      const thirdLo = parts[2].trim().toLowerCase();
      state = US_STATE_NAMES[secondLo] || (US_STATES.has(secondUp) ? secondUp : null) || second;
      country = FULL_COUNTRY_NAMES[thirdLo]
        || (COUNTRY_CODES.has(parts[2].trim().toLowerCase()) ? parts[2].trim().toUpperCase() : null)
        || parts[2].trim();
      if (country === 'UK') country = 'GB';
    } else if (US_STATE_NAMES[secondLo]) {
      state   = US_STATE_NAMES[secondLo];
      country = 'US';
    } else if (secondUp in AMBIGUOUS) {
      const amb    = AMBIGUOUS[secondUp];
      const cityLo = city.toLowerCase().trim();
      if (amb.defaultToUS) {
        // cities = known foreign cities
        if (amb.cities.has(cityLo)) {
          country = amb.country;
        } else if (US_CITY_STATE[cityLo] === secondUp) {
          // DB1 confirms this city is specifically in this state
          state = secondUp; country = 'US';
        } else {
          state = secondUp; country = 'US';
        }
      } else {
        // cities = known US cities (small state like DE); default → foreign country
        if (amb.cities.has(cityLo)) { state = secondUp; country = 'US'; }
        else { country = amb.country; }
      }
    } else if (secondUp === 'SA') {
      // SA = South Africa (ZA) by default; Saudi cities → SA
      const SAUDI_CITIES = new Set(['riyadh','jeddah','mecca','medina','dammam','khobar','al khobar','tabuk','abha','taif','buraidah','khamis mushait','jubail','yanbu','najran','hail','hofuf','al ahsa']);
      country = SAUDI_CITIES.has(city.toLowerCase().trim()) ? 'SA' : 'ZA';
    } else if (COUNTRY_CODES.has(secondLo) && !US_STATES.has(secondUp)) {
      country = secondLo === 'uk' ? 'GB' : secondUp;
    } else if (US_STATES.has(secondUp)) {
      state   = secondUp;
      country = 'US';
    } else if (FULL_COUNTRY_NAMES[secondLo]) {
      country = FULL_COUNTRY_NAMES[secondLo];
    } else {
      // Unknown second part — store as-is
      country = second;
    }
  }

  if (state && !country) country = 'US';

  // Build display_name: "City, Full State, Full Country"
  const fullCountry = country ? (CODE_TO_FULL[country] || (country.length === 2 ? country : country)) : null;
  const fullState   = state   ? (US_STATE_FULL[state]  || state) : null;
  const display     = [city, fullState, fullCountry].filter(Boolean).join(', ');

  return { display_name: display || cleaned, is_remote: false };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function run() {
  console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY RUN'}\n`);

  let offset = 0;
  const PAGE = 1000;
  let fixed = 0, skipped = 0, errors = 0;

  while (true) {
    const { data: rows, error } = await db
      .from('locations')
      .select('id, display_name, is_remote')
      .range(offset, offset + PAGE - 1);

    if (error) { console.error('Fetch error:', error.message); break; }
    if (!rows?.length) break;

    for (const row of rows) {
      if (row.is_remote) { skipped++; continue; }

      const parsed = parseLocation(row.display_name);
      if (!parsed || parsed.display_name === row.display_name) { skipped++; continue; }

      console.log(`  "${row.display_name}"  →  "${parsed.display_name}"`);

      if (APPLY) {
        const { error: upErr } = await db
          .from('locations')
          .update({ display_name: parsed.display_name })
          .eq('id', row.id);

        if (upErr) {
          if (upErr.message?.includes('duplicate key') || upErr.message?.includes('unique constraint')) {
            // Another row already has this display_name — merge: point jobs to it, delete this row
            const { data: existing } = await db
              .from('locations')
              .select('id')
              .eq('display_name', parsed.display_name)
              .single();
            if (existing) {
              await db.from('jobs').update({ location_id: existing.id }).eq('location_id', row.id);
              await db.from('locations').delete().eq('id', row.id);
              console.log(`    merged into existing "${parsed.display_name}"`);
            } else {
              console.error(`    ERROR: ${upErr.message}`); errors++;
            }
          } else {
            console.error(`    ERROR: ${upErr.message}`); errors++;
          }
        }
      }
      fixed++;
    }

    offset += rows.length;
    if (rows.length < PAGE) break;
  }

  console.log(`\n${fixed} to fix, ${skipped} unchanged, ${errors} errors.`);
  if (!APPLY && fixed > 0) console.log('Run with --apply to write changes.');
}

run();
