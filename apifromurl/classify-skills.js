/**
 * classify-skills.js — Tag skills with skill_type, remove garbage entries
 *
 * Reads:  Main DB skills table (only skills actually used in job_skills)
 * Writes: skills.category for each matched skill
 * Deletes: job_skills rows for 'remove'-categorised skills
 *
 * Uses the existing skills.category column (no migration needed).
 *
 * category values:
 *   language   — programming languages (Python, Java, SQL, Go...)
 *   framework  — frameworks & libraries (React, Node.js, Spring...)
 *   platform   — cloud/infra/databases (AWS, Kubernetes, Snowflake...)
 *   tool       — specific software products (Salesforce, Tableau, Jira...)
 *   security   — security skills/certs (SIEM, SOC 2, HIPAA, IAM...)
 *   healthcare — healthcare-specific (EHR, clinical documentation...)
 *   trade      — skilled trades (HVAC, Carpentry, Electrical, CAD...)
 *   domain     — methodologies & concepts (Agile, MLOps, DevOps, CI/CD...)
 *   marketing  — marketing tools/skills (SEO, GA4, SEMrush, GTM...)
 *   remove     — generic words / garbage (Teams, AMP, IMPACT, Make...)
 *
 * Usage:
 *   node classify-skills.js           → dry run, prints classification
 *   node classify-skills.js --write   → updates DB
 */

import { createClient } from '@supabase/supabase-js';

const MAIN_URL = process.env.MAIN_DB_URL || 'https://osoilvzyyjmrbjsiyrgs.supabase.co';
const MAIN_KEY = process.env.MAIN_DB_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9zb2lsdnp5eWptcmJqc2l5cmdzIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDE1NTgwOCwiZXhwIjoyMDg5NzMxODA4fQ.CRdcA7hoSV9CMuFVOJjWAHZis-zjI99BpwphaX1Xl6w';

const WRITE = process.argv.includes('--write');
const main = createClient(MAIN_URL, MAIN_KEY);

// ─── SKILL TYPE DEFINITIONS ───────────────────────────────────────────────────

const LANGUAGES = new Set([
  'Python', 'Java', 'Go', 'SQL', 'TypeScript', 'Typescript', 'JavaScript',
  'JavaScript/TypeScript', 'Bash', 'Ruby', 'Golang', 'HTML', 'R', 'Scala',
  'Kotlin', 'Swift', 'PHP', 'Rust', 'Elixir', 'Perl', 'PowerShell', 'CSS',
  'GraphQL', 'Groovy', 'YAML', 'Dart', 'Lua', 'Assembly', 'COBOL', 'Fortran',
]);

const FRAMEWORKS = new Set([
  'React', 'Node.js', 'Next.js', 'Spring', 'Rails', 'Phoenix', 'Django',
  'Flask', 'FastAPI', 'Express', 'Vue', 'Angular', 'Svelte', 'Helm',
  'RestAssured', 'Rest Assured', 'gRPC', 'REST APIs', 'REST',
  'Playwright', 'Selenium', 'Cypress', 'Jest', 'Pytest', 'JUnit',
]);

const PLATFORMS = new Set([
  'AWS', 'Azure', 'GCP', 'Kubernetes', 'Docker', 'GitHub', 'Git', 'Linux',
  'Windows', 'MacOS', 'Snowflake', 'Redshift', 'DynamoDB', 'S3', 'Lambda',
  'CloudWatch', 'Redis', 'MongoDB', 'PostgreSQL', 'ClickHouse', 'Spark',
  'Kafka', 'Android', 'iOS', 'Airflow', 'Prometheus', 'Grafana', 'Nexus',
  'Cloud', 'Public Cloud', 'Cloud Infrastructure', 'Cloud-Native', 'Splunk',
  'Elasticsearch', 'Cassandra', 'MySQL', 'SQLite', 'Oracle', 'DB2',
  'Databricks', 'Hadoop', 'Hive', 'Flink', 'Pulsar', 'RabbitMQ',
  'DBT', 'Cloud services',
]);

const TOOLS = new Set([
  'Terraform', 'Ansible', 'Jenkins', 'Tableau', 'Metabase', 'Looker',
  'Qlik', 'Sigma', 'ServiceNow', 'Workday', 'SAP', 'Microsoft Excel',
  'Microsoft Office', 'Google Workspace', 'Slack', 'Zoom', 'Outlook', 'Gmail',
  'Salesforce', 'HubSpot', 'ZoomInfo', 'Workato', 'PagerDuty', 'Vanta',
  'Github Actions', 'Jira', 'Confluence', 'Datadog', 'Runway', 'Copilot',
  'Twilio', 'Okta', 'Vapi', 'SAP S/4HANA', 'SAP S/4HANA Cloud',
  'S/4HANA', 'S/4HANA Cloud', 'Deltek Vantagepoint', 'Vantagepoint',
  'IVANTI', 'TMS', 'Opera', 'Baan', 'Juniper', 'CAD', 'Spreadsheets',
  'Microsoft', 'Greenhouse', 'ATS', 'Applicant Tracking System',
  'Figma', 'Sketch', 'Adobe XD', 'Illustrator', 'Photoshop', 'InDesign',
  'After Effects', 'Premiere', 'Final Cut', 'Notion', 'Asana', 'Monday',
  'ClickUp', 'Trello', 'Linear', 'Shortcut', 'Zendesk', 'Intercom',
  'Freshdesk', 'Mixpanel', 'Amplitude', 'Segment', 'Braze', 'Klaviyo',
  'Marketo', 'Pardot', 'Mailchimp', 'Sendgrid', 'Stripe', 'Plaid',
  'QuickBooks', 'NetSuite', 'Sage', 'Xero', 'Coupa', 'Concur',
  'Workstream', 'Greenhouse', 'Lever', 'Ashby', 'Rippling', 'BambooHR',
  'Google Analytics', 'GA4', 'Hotjar', 'Heap', 'FullStory',
]);

const SECURITY = new Set([
  'SIEM', 'SOC', 'SOAR', 'XDR', 'EDR', 'IAM', 'SSO', 'PKI', 'SAML',
  'CompTIA Security+', 'SOC 2', 'GRC', 'HIPAA', 'ISO', 'Cloud Security',
  'Security monitoring', 'Incident response', 'Threat Intelligence',
  'Identity and Access Management', 'Access Control', 'Endpoint Security',
  'Zero Trust', 'GDPR', 'CCPA', 'FedRAMP', 'PCI DSS', 'NIST',
  'Penetration Testing', 'Vulnerability Management', 'SAST', 'DAST',
  'IDS', 'IPS', 'Firewall', 'VPN', 'MFA', 'RBAC', 'PAM',
  'Data protection', 'Cybersecurity', 'YARA',
]);

const HEALTHCARE = new Set([
  'EHR', 'Electronic Health Records (EHR)', 'Electronic Health Records',
  'clinical documentation', 'EMR', 'ICD-10', 'CPT', 'HL7', 'FHIR',
  'DICOM', 'Epic', 'Cerner', 'Meditech', 'Allscripts', 'EAP',
]);

const TRADES = new Set([
  'HVAC', 'Carpentry', 'Electrical', 'hand tools', 'diagnostic equipment',
  'Welding', 'Plumbing', 'Painting', 'Masonry', 'Roofing', 'Pipefitting',
  'Sheet Metal', 'Ironwork', 'Concrete', 'Drywall', 'Flooring',
  'Forklift', 'Crane', 'Rigging', 'PLC', 'CNC', 'CAM',
]);

const DOMAIN = new Set([
  'Machine Learning', 'AI/ML', 'MLOps', 'LLMs', 'DevOps', 'SRE', 'Agile',
  'Scrum', 'SAFe', 'SDLC', 'CI/CD', 'CI/CD pipelines', 'Observability',
  'Networking', 'TCP/IP', 'DNS', 'DHCP', 'APIs', 'API', 'SDKs',
  'Orchestration', 'Integration', 'Workflow automation', 'Test Automation',
  'iPaaS', 'ITIL', 'ITSM', 'ERP', 'MES', 'MRP', 'System Administration',
  'System Integration', 'Regulatory compliance', 'risk assessment',
  'Quality control', 'Quality Systems', 'Data analysis', 'Data modeling',
  'Data Integrity', 'Data Analytics', 'Data warehousing', 'Statistical Analysis',
  'OLAP', 'Forecasting', 'Budgeting', 'Auditing', 'Financial reporting',
  'Financial products', 'Payment processing', 'Card networks', 'BI',
  'SaaS', 'OT', 'Robotics', 'Prototyping', 'Accessibility',
  'Incident Management', 'Root cause analysis', 'debugging', 'Scripting',
  'SOPs', 'Infrastructure', 'Microservices', 'Distributed Systems',
  'AI agents', 'Agentic AI', 'RAG', 'Vector databases', 'Vector',
  'AI frameworks', 'Software Development', 'Backend', 'REST APIs',
  'Web Applications', 'Merchandising', 'E-commerce', 'Estimating',
  'Data Entry', 'project management', 'Technical documentation',
  'Safety procedures', 'Pipelines', 'SDLC', 'Cloud Security',
  'Cloud-Native', 'Artificial Intelligence', 'NLP', 'Computer Vision',
  'Reinforcement Learning', 'Data Science', 'Big Data', 'ETL',
  'Microservices Architecture', 'Event-Driven Architecture',
  'SOA', 'gRPC', 'GraphQL', 'WebSockets', 'Load Balancing',
  'Caching', 'Sharding', 'Replication', 'High Availability',
  'Disaster Recovery', 'Business Continuity', 'SLA', 'OKR',
  'Six Sigma', 'Lean', 'Kaizen', 'ISO 9001', 'ISO 27001',
  'Supply Chain', 'Procurement', 'Logistics', 'Inventory management',
  'Driver\'s license', 'Forklift certification', 'OSHA',
  'Patient care', 'Clinical trials', 'GCP', 'GMP', 'FDA',
  'Curriculum development', 'Instructional design',
  'Copywriting', 'Content strategy', 'Brand management',
  'Public speaking', 'Presentation', 'Report writing',
  'scalability', 'customer service', 'Analytics', 'Validation',
  'payment processing', 'HTTP', 'SOLID', 'Information systems',
  'SOP', 'Product Metrics', 'ML', 'CLI', 'Data protection',
]);

const MARKETING = new Set([
  'SEO', 'SEMrush', 'GA4', 'GTM', 'Ahrefs', '6sense', 'Web analytics',
  'Instagram', 'Twitter', 'Facebook', 'Meta', 'LinkedIn', 'TikTok',
  'Google Ads', 'Facebook Ads', 'Paid Social', 'PPC', 'SEM', 'CRO',
  'A/B Testing', 'Email marketing', 'Content marketing', 'Demand generation',
  'Lead generation', 'ABM', 'Growth hacking', 'Affiliate marketing',
  'Influencer marketing', 'Social media management',
]);

// Skills to REMOVE — generic words / ambiguous / not real skills
const REMOVE = new Set([
  'Teams', 'AMP', 'IMPACT', 'Make', 'IT', 'M', 'Die', 'CA', 'SF', 'AD',
  'Phone', 'Video', 'Drives', 'Combine', 'Click', 'Scales', 'VOICE',
  'Computer', 'Office', 'Software', 'Systems', 'Data', 'AI', 'Monitoring',
  'Onboarding', 'Applications', 'Tools', 'Project', 'Web', 'Databases',
  'Tooling', 'Testing', 'Workplace', 'Connect', 'Internet', 'Search',
  'Measurement', 'Flows', 'Profile', 'Storage', 'Equipment', 'Vehicle',
  'Precision', 'Documentation', 'Organizations', 'Messaging', 'IDEAS',
  'Recruitment', 'Mentor', 'Hybrid', 'English', 'Programming', 'TIPS',
  'Dashboards', 'Scalability', 'Troubleshooting', 'Knowledge base',
  'Training materials', 'Communication Programs', 'Relationship management',
  'Stakeholder Management', 'Negotiation', 'CS', 'SD', 'MM', 'WM', 'QM',
  'CES', 'CAO', 'CSM', 'LINE', 'MUSE', 'Monitor', 'AI tools',
  'Digital tools', 'Enterprise software', 'Cloud platforms', 'Imaging',
  'Smartphone', 'Servers', 'Hardware', 'Maintenance', 'Camera', 'lift',
  'CI', 'AI tooling', 'Flex', 'NICE', 'AIM', 'BAS', 'EMS', 'SMB',
  'Sourcing', 'Wordpress', 'Claude', 'and Compliance', 'DOE',
  'Modelling', 'Inventory', 'Settlement', 'Licensing', 'Clarity',
  'Visual', 'ADS', 'TENS', 'IPS', 'Functions', 'OT',
  'Kraken', 'controls', 'UPS', 'Policy', 'Momentum', 'Planner',
  'leadership', 'Workspaces', 'Email', 'invoicing', 'Metrics',
  'Scale', 'Performance', 'Reports', 'MAP', 'Google', 'Access',
  'CAN', 'SAN', 'Audit tools', 'Security', 'Risk Management',
  'Automation', 'Cybersecurity reports', 'LLM', 'Adobe',
]);

// ─── CLASSIFY ─────────────────────────────────────────────────────────────────

function classifySkill(name) {
  if (REMOVE.has(name))      return 'remove';
  if (LANGUAGES.has(name))   return 'language';
  if (FRAMEWORKS.has(name))  return 'framework';
  if (PLATFORMS.has(name))   return 'platform';
  if (TOOLS.has(name))       return 'tool';
  if (SECURITY.has(name))    return 'security';
  if (HEALTHCARE.has(name))  return 'healthcare';
  if (TRADES.has(name))      return 'trade';
  if (MARKETING.has(name))   return 'marketing';
  if (DOMAIN.has(name))      return 'domain';
  return null; // unclassified — will be printed for manual review
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

async function run() {
  console.log('══════════════════════════════════════════');
  console.log('SKILL CLASSIFIER');
  if (!WRITE) console.log('DRY RUN — pass --write to update DB');
  console.log('══════════════════════════════════════════\n');

  // Load all skills actually used in job_skills (two-step: ids first, then batch fetch)
  const { data: usedLinks } = await main
    .from('job_skills')
    .select('skill_id')
    .limit(100000);

  const skillIds = [...new Set((usedLinks || []).map(r => r.skill_id))];

  const skillsMap = new Map();
  const BATCH = 200;
  for (let i = 0; i < skillIds.length; i += BATCH) {
    const { data } = await main
      .from('skills')
      .select('id, name, slug, category')
      .in('id', skillIds.slice(i, i + BATCH));
    for (const s of data || []) skillsMap.set(s.id, s);
  }

  console.log(`Distinct skills in use: ${skillsMap.size}\n`);

  const byType = {};
  const unclassified = [];
  const toRemoveIds = [];

  for (const skill of skillsMap.values()) {
    const type = classifySkill(skill.name);
    if (!type) {
      unclassified.push(skill.name);
      continue;
    }
    if (!byType[type]) byType[type] = [];
    byType[type].push(skill.name);
    if (type === 'remove') toRemoveIds.push(skill.id);
  }

  // Print results
  const ORDER = ['language', 'framework', 'platform', 'tool', 'security', 'healthcare', 'trade', 'marketing', 'domain', 'remove'];
  for (const type of ORDER) {
    const skills = byType[type] || [];
    if (skills.length === 0) continue;
    console.log(`── ${type.toUpperCase()} (${skills.length}) ──`);
    console.log('  ' + skills.join(', '));
    console.log('');
  }

  if (unclassified.length > 0) {
    console.log(`── UNCLASSIFIED — needs manual review (${unclassified.length}) ──`);
    console.log('  ' + unclassified.join(', '));
    console.log('');
  }

  console.log('── SUMMARY ──');
  for (const type of ORDER) {
    console.log(`  ${(type + ':').padEnd(14)} ${(byType[type] || []).length}`);
  }
  console.log(`  ${'unclassified:'.padEnd(14)} ${unclassified.length}`);
  console.log(`  ${'will remove:'.padEnd(14)} ${toRemoveIds.length} skills → delete from job_skills`);

  if (!WRITE) {
    console.log('\nRun with --write to apply changes to DB.');
    return;
  }

  console.log('\nWriting to DB...');

  // 1. Update skill_type for all classified skills
  let updated = 0;
  for (const skill of skillsMap.values()) {
    const type = classifySkill(skill.name);
    if (!type) continue;
    const { error } = await main.from('skills').update({ category: type }).eq('id', skill.id);
    if (!error) updated++;
  }
  console.log(`  Updated category on ${updated} skills`);

  // 2. Delete job_skills rows for 'remove'-typed skills
  if (toRemoveIds.length > 0) {
    const CHUNK = 100;
    let deleted = 0;
    for (let i = 0; i < toRemoveIds.length; i += CHUNK) {
      const chunk = toRemoveIds.slice(i, i + CHUNK);
      const { count } = await main.from('job_skills')
        .delete({ count: 'exact' })
        .in('skill_id', chunk);
      deleted += count || 0;
    }
    console.log(`  Deleted ${deleted} job_skills rows for 'remove' skills`);
  }

  // 3. Delete job_skills rows for skills with null category (unclassified garbage)
  const { data: nullSkills } = await main.from('skills').select('id').is('category', null);
  const nullIds = (nullSkills || []).map((s) => s.id);
  if (nullIds.length > 0) {
    const CHUNK = 100;
    let deleted = 0;
    for (let i = 0; i < nullIds.length; i += CHUNK) {
      const chunk = nullIds.slice(i, i + CHUNK);
      const { count } = await main.from('job_skills')
        .delete({ count: 'exact' })
        .in('skill_id', chunk);
      deleted += count || 0;
    }
    console.log(`  Deleted ${deleted} job_skills rows for null-category skills`);
  }

  console.log('\nDone. Run refiner.js next to re-extract skills for future jobs.');
}

run().catch(console.error);
