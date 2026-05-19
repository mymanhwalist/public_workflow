/**
 * Test ATS Detection
 * Test the detector with sample URLs
 */

import { detectATS, buildAPIEndpoint, getSupportedATS } from './ats-detector.js';

// Sample application URLs to test
const testURLs = [
  // With Public API
  'https://jobs.lever.co/acme-corp/abc-123',
  'https://boards.greenhouse.io/stripe/jobs/12345',
  'https://jobs.ashbyhq.com/notion/abc-def',
  'https://apply.workable.com/figma/j/123456/',
  'https://jobs.smartrecruiters.com/Square/123456',
  'https://acme.bamboohr.com/careers/123',
  'https://acme.recruitee.com/o/senior-developer',
  'https://acme.breezy.hr/p/abc123-software-engineer',

  // Without Public API
  'https://company.myworkdayjobs.com/en-US/careers/job/12345',
  'https://hyatt.taleo.net/careersection/application.jss?job=12345',
  'https://krb-sjobs.brassring.com/TGnewUI/Search/home/HomeWithPreLoad?partnerid=123',
  'https://careers-acme.icims.com/jobs/12345/job',
  'https://myjobs.adp.com/company/cx/job-details?reqId=12345',

  // Job Boards (no API)
  'https://www.indeed.com/viewjob?jk=abc123',
  'https://www.linkedin.com/jobs/view/12345',

  // Custom career pages
  'https://company.com/careers/job-123',
  'https://jobs.example.com/positions/dev-role',

  // Unknown
  'https://example.com/apply'
];

console.log('===========================================');
console.log('ATS DETECTION TEST');
console.log('===========================================');
console.log('');

console.log('Supported ATS Providers:');
console.log('------------------------');
const supported = getSupportedATS();
const withAPI = supported.filter(a => a.hasPublicAPI);
const withoutAPI = supported.filter(a => !a.hasPublicAPI);
console.log(`With Public API (${withAPI.length}): ${withAPI.map(a => a.provider).join(', ')}`);
console.log(`Without Public API (${withoutAPI.length}): ${withoutAPI.map(a => a.provider).join(', ')}`);
console.log('');

console.log('Test Results:');
console.log('------------------------');

for (const url of testURLs) {
  const atsInfo = detectATS(url);
  const api = buildAPIEndpoint(url, atsInfo);

  const apiStatus = api ? `API: ${api.list}` : 'No public API';
  const icon = api ? '✅' : '⚠️';

  console.log(`${icon} ${atsInfo.provider}`);
  console.log(`   URL: ${url.substring(0, 60)}...`);
  console.log(`   ${apiStatus}`);
  console.log('');
}

console.log('===========================================');
console.log('TEST COMPLETE');
console.log('===========================================');
