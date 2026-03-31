#!/usr/bin/env node
'use strict';

const { resolveRepoPath, writeJsonFile } = require('./lib/io.js');

function withIds(rows, prefix) {
  return rows.map((row, idx) => ({
    case_id: `${prefix}-${String(idx + 1).padStart(3, '0')}`,
    ...row,
  }));
}

const routerObvious = withIds([
  { name: 'pkm prefix override', bucket: 'obvious', failure_tags: ['prefix_override'], input: { text: 'pkm: remember to buy milk' }, expect: { route: 'pkm_capture' } },
  { name: 'slash command passthrough', bucket: 'obvious', failure_tags: ['slash_passthrough'], input: { text: '/help' }, expect: { route: 'pkm_capture' } },
  { name: 'cal prefix create', bucket: 'obvious', failure_tags: ['prefix_override'], input: { text: 'cal: Mila dentist tomorrow at 3:00p' }, expect: { route: 'calendar_create' } },
  { name: 'cal prefix query', bucket: 'obvious', failure_tags: ['prefix_override'], input: { text: 'cal: what do we have tomorrow?' }, expect: { route: 'calendar_query' } },
  { name: 'obvious calendar query tomorrow', bucket: 'obvious', failure_tags: ['baseline_route'], input: { text: 'what do we have tomorrow on calendar?' }, expect: { route: 'calendar_query' } },
  { name: 'weekday list query', bucket: 'obvious', failure_tags: ['baseline_route'], input: { text: 'list events friday' }, expect: { route: 'calendar_query' } },
  { name: 'calendar question sunday', bucket: 'obvious', failure_tags: ['baseline_route'], input: { text: 'do we have plans sunday?' }, expect: { route: 'calendar_query' } },
  { name: 'anything planned query', bucket: 'obvious', failure_tags: ['baseline_route'], input: { text: 'anything planned tomorrow?' }, expect: { route: 'calendar_query' } },
  { name: 'dentist create', bucket: 'obvious', failure_tags: ['baseline_route'], input: { text: 'Mila dentist tomorrow at 3:00p' }, expect: { route: 'calendar_create' } },
  { name: 'vet create', bucket: 'obvious', failure_tags: ['baseline_route'], input: { text: 'book Louie vet friday at 9:00a' }, expect: { route: 'calendar_create' } },
  { name: 'appointment create', bucket: 'obvious', failure_tags: ['baseline_route'], input: { text: 'appointment monday at 10:00a for Igor' }, expect: { route: 'calendar_create' } },
  { name: 'birthday create', bucket: 'obvious', failure_tags: ['baseline_route'], input: { text: 'birthday party saturday at 1:00p for Mila' }, expect: { route: 'calendar_create' } },
  { name: 'iso-date create', bucket: 'obvious', failure_tags: ['baseline_route'], input: { text: 'add trip on 2026-04-10 at 6:30p' }, expect: { route: 'calendar_create' } },
  { name: 'create verb create', bucket: 'obvious', failure_tags: ['baseline_route'], input: { text: 'create family event tomorrow at 7:00p' }, expect: { route: 'calendar_create' } },
  { name: 'remind create', bucket: 'obvious', failure_tags: ['baseline_route'], input: { text: 'remind Mila school pickup tomorrow 4:00p' }, expect: { route: 'calendar_create' } },
  { name: 'book create', bucket: 'obvious', failure_tags: ['baseline_route'], input: { text: 'book dentist for Mila tomorrow at 2:15p' }, expect: { route: 'calendar_create' } },
  { name: 'show calendar monday', bucket: 'obvious', failure_tags: ['baseline_route'], input: { text: 'show calendar monday' }, expect: { route: 'calendar_query' } },
  { name: 'calendar tomorrow query', bucket: 'obvious', failure_tags: ['baseline_route'], input: { text: 'calendar tomorrow?' }, expect: { route: 'calendar_query' } },
  { name: 'pkm prefix calendar-looking text', bucket: 'obvious', failure_tags: ['prefix_override'], input: { text: 'pkm: calendar tomorrow 3pm' }, expect: { route: 'pkm_capture' } },
  { name: 'explicit query with events', bucket: 'obvious', failure_tags: ['baseline_route'], input: { text: 'what events do we have on tuesday?' }, expect: { route: 'calendar_query' } },
], 'R-OBV');

const routerAmbiguous = withIds([
  { name: 'calendar tomorrow with time', bucket: 'ambiguous', failure_tags: ['bad_clarification_decision'], input: { text: 'calendar tomorrow 3pm' }, expect: { route: 'ambiguous' } },
  { name: 'schedule request with can you', bucket: 'ambiguous', failure_tags: ['bad_clarification_decision'], input: { text: 'can you schedule Mila dentist tomorrow at 3pm?' }, expect: { route: 'ambiguous' } },
  { name: 'set schedule tomorrow', bucket: 'ambiguous', failure_tags: ['bad_clarification_decision'], input: { text: 'set schedule for tomorrow' }, expect: { route: 'ambiguous' } },
  { name: 'do we have dentist tomorrow at time', bucket: 'ambiguous', failure_tags: ['bad_clarification_decision'], input: { text: 'do we have dentist tomorrow at 3pm' }, expect: { route: 'ambiguous' } },
  { name: 'calendar friday meeting with time', bucket: 'ambiguous', failure_tags: ['bad_clarification_decision'], input: { text: 'calendar friday 9am meeting' }, expect: { route: 'ambiguous' } },
  { name: 'what should I put on calendar with time', bucket: 'ambiguous', failure_tags: ['bad_clarification_decision'], input: { text: 'what should I put on calendar tomorrow at 8am' }, expect: { route: 'ambiguous' } },
  { name: 'schedule calendar event', bucket: 'ambiguous', failure_tags: ['bad_clarification_decision'], input: { text: 'schedule calendar event tomorrow at 6pm' }, expect: { route: 'ambiguous' } },
  { name: 'list plans with create signal', bucket: 'ambiguous', failure_tags: ['bad_clarification_decision'], input: { text: 'list plans tomorrow 4pm birthday' }, expect: { route: 'ambiguous' } },
  { name: 'events tomorrow add vet', bucket: 'ambiguous', failure_tags: ['bad_clarification_decision'], input: { text: 'events tomorrow add vet at 9am' }, expect: { route: 'ambiguous' } },
  { name: 'book calendar appointment', bucket: 'ambiguous', failure_tags: ['bad_clarification_decision'], input: { text: 'can we book calendar appointment tomorrow 11am' }, expect: { route: 'ambiguous' } },
  { name: 'show schedule with party time', bucket: 'ambiguous', failure_tags: ['bad_clarification_decision'], input: { text: 'show schedule for saturday 2pm party' }, expect: { route: 'ambiguous' } },
  { name: 'calendar monday trip time', bucket: 'ambiguous', failure_tags: ['bad_clarification_decision'], input: { text: 'calendar monday 7pm trip' }, expect: { route: 'ambiguous' } },
  { name: 'anything on calendar with time', bucket: 'ambiguous', failure_tags: ['bad_clarification_decision'], input: { text: 'anything on calendar tomorrow at 5pm for Mila' }, expect: { route: 'ambiguous' } },
  { name: 'plans friday doctor time', bucket: 'ambiguous', failure_tags: ['bad_clarification_decision'], input: { text: 'plans friday 8am doctor' }, expect: { route: 'ambiguous' } },
  { name: 'iso datetime meeting with calendar', bucket: 'ambiguous', failure_tags: ['bad_clarification_decision'], input: { text: 'calendar 2026-04-09 14:00 meeting' }, expect: { route: 'ambiguous' } },
], 'R-AMB');

const routerAdversarial = withIds([
  { name: 'plain note no routing cues', bucket: 'adversarial_edge', failure_tags: ['false_positive_calendar_create'], input: { text: 'need to call mom tonight' }, expect: { route: 'pkm_capture' } },
  { name: 'date word only', bucket: 'adversarial_edge', failure_tags: ['false_positive_calendar_create'], input: { text: 'tomorrow maybe' }, expect: { route: 'pkm_capture' } },
  { name: 'calendar-like plural noun', bucket: 'adversarial_edge', failure_tags: ['false_positive_calendar_create'], input: { text: 'random thought about calendars' }, expect: { route: 'pkm_capture' } },
  { name: 'calzone false friend', bucket: 'adversarial_edge', failure_tags: ['false_positive_calendar_create'], input: { text: 'calzone for dinner tomorrow' }, expect: { route: 'pkm_capture' } },
  { name: 'eventful adjective', bucket: 'adversarial_edge', failure_tags: ['false_positive_calendar_create'], input: { text: 'eventful day today' }, expect: { route: 'pkm_capture' } },
  { name: 'calendar generic statement', bucket: 'adversarial_edge', failure_tags: ['adversarial_query'], input: { text: 'calendar is chaotic lately' }, expect: { route: 'calendar_query' } },
  { name: 'what is today', bucket: 'adversarial_edge', failure_tags: ['adversarial_query'], input: { text: 'what is today' }, expect: { route: 'calendar_query' } },
  { name: 'meeting without date time', bucket: 'adversarial_edge', failure_tags: ['false_positive_calendar_create'], input: { text: 'I have a meeting agenda draft' }, expect: { route: 'pkm_capture' } },
  { name: 'meeting with time no date', bucket: 'adversarial_edge', failure_tags: ['adversarial_create'], input: { text: 'meeting at 15:00 maybe' }, expect: { route: 'calendar_create' } },
  { name: 'weekday and plan noun', bucket: 'adversarial_edge', failure_tags: ['false_positive_calendar_create'], input: { text: 'friday dinner plan' }, expect: { route: 'pkm_capture' } },
  { name: 'show me generic', bucket: 'adversarial_edge', failure_tags: ['false_positive_calendar_create'], input: { text: 'show me something cool' }, expect: { route: 'pkm_capture' } },
  { name: 'slash status command', bucket: 'adversarial_edge', failure_tags: ['slash_passthrough'], input: { text: '/status' }, expect: { route: 'pkm_capture' } },
  { name: 'cal prefix without details', bucket: 'adversarial_edge', failure_tags: ['prefix_override'], input: { text: 'cal: just checking' }, expect: { route: 'calendar_create' } },
  { name: 'pkm prefix with create words', bucket: 'adversarial_edge', failure_tags: ['prefix_override'], input: { text: 'pkm: add dentist tomorrow 3pm' }, expect: { route: 'pkm_capture' } },
  { name: 'events stressful statement', bucket: 'adversarial_edge', failure_tags: ['adversarial_query'], input: { text: 'events are stressful' }, expect: { route: 'calendar_query' } },
], 'R-ADV');

const routerStateful = withIds([
  {
    name: 'continuation answer routes to calendar_create',
    bucket: 'stateful_continuation',
    failure_tags: ['stateful_continuation'],
    setup: { type: 'normalize_open_request', raw_text: 'birthday party saturday', expect_status: 'needs_clarification' },
    input: { text: 'for Mila at 3:00p for 2 hours' },
    expect: { route: 'calendar_create' },
  },
  {
    name: 'continuation with actor answer',
    bucket: 'stateful_continuation',
    failure_tags: ['stateful_continuation'],
    setup: { type: 'normalize_open_request', raw_text: 'doctor appointment tomorrow', expect_status: 'needs_clarification' },
    input: { text: '9:30a with Igor' },
    expect: { route: 'calendar_create' },
  },
  {
    name: 'structured pkm prefix bypasses continuation',
    bucket: 'stateful_continuation',
    failure_tags: ['stateful_continuation'],
    setup: { type: 'normalize_open_request', raw_text: 'kids dentist tomorrow', expect_status: 'needs_clarification' },
    input: { text: 'pkm: this is a separate note' },
    expect: { route: 'pkm_capture' },
  },
  {
    name: 'slash command bypasses continuation',
    bucket: 'stateful_continuation',
    failure_tags: ['stateful_continuation'],
    setup: { type: 'normalize_open_request', raw_text: 'school meeting thursday', expect_status: 'needs_clarification' },
    input: { text: '/today' },
    expect: { route: 'pkm_capture' },
  },
  {
    name: 'unstructured short follow-up uses continuation',
    bucket: 'stateful_continuation',
    failure_tags: ['stateful_continuation'],
    setup: { type: 'normalize_open_request', raw_text: 'birthday saturday', expect_status: 'needs_clarification' },
    input: { text: 'cal tomorrow' },
    expect: { route: 'calendar_create' },
  },
  {
    name: 'structured cal prefix stays query',
    bucket: 'stateful_continuation',
    failure_tags: ['stateful_continuation'],
    setup: { type: 'normalize_open_request', raw_text: 'party tomorrow', expect_status: 'needs_clarification' },
    input: { text: 'cal: what do we have tomorrow?' },
    expect: { route: 'calendar_query' },
  },
  {
    name: 'time-only follow-up uses continuation',
    bucket: 'stateful_continuation',
    failure_tags: ['stateful_continuation'],
    setup: { type: 'normalize_open_request', raw_text: 'Mila swim practice saturday', expect_status: 'needs_clarification' },
    input: { text: 'tomorrow 3pm' },
    expect: { route: 'calendar_create' },
  },
  {
    name: 'query-looking follow-up still continuation',
    bucket: 'stateful_continuation',
    failure_tags: ['stateful_continuation'],
    setup: { type: 'normalize_open_request', raw_text: 'Louie vet sunday', expect_status: 'needs_clarification' },
    input: { text: 'what do we have tomorrow?' },
    expect: { route: 'calendar_create' },
  },
], 'R-STATE');

const normalizeClean = withIds([
  { name: 'mila dentist default med duration', bucket: 'clean', failure_tags: ['field_extraction'], input: { raw_text: 'Mila dentist tomorrow at 3:00p' }, expect: { status: 'ready_to_create', category_code: 'MED', duration_minutes: 60, subject_people_tag: 'M' } },
  { name: 'home no padding explicit duration', bucket: 'clean', failure_tags: ['field_extraction'], input: { raw_text: 'Mila appointment tomorrow at 3:00p for 90 min at home' }, expect: { status: 'ready_to_create', category_code: 'MED', duration_minutes: 90, padded: false, subject_people_tag: 'M' } },
  { name: 'louie vet default dog duration', bucket: 'clean', failure_tags: ['field_extraction'], input: { raw_text: 'Louie vet friday at 9:00a' }, expect: { status: 'ready_to_create', category_code: 'DOG', duration_minutes: 60, subject_people_tag: 'L' } },
  { name: 'family birthday collapse', bucket: 'clean', failure_tags: ['field_extraction'], input: { raw_text: 'Mila Iva Louie Igor Danijela birthday tomorrow at 1:00p' }, expect: { status: 'ready_to_create', category_code: 'EVT', duration_minutes: 180, subject_people_tag: 'FAM', logical_color: 'green' } },
  { name: 'igor danijela meeting admin', bucket: 'clean', failure_tags: ['field_extraction'], input: { raw_text: 'Igor Danijela meeting monday at 10:00a for 30 min' }, expect: { status: 'ready_to_create', category_code: 'ADM', duration_minutes: 30, subject_people_tag: 'Ig,D' } },
  { name: 'school meeting kid category', bucket: 'clean', failure_tags: ['field_extraction'], input: { raw_text: 'Iva school meeting tuesday at 14:00 for 45 min' }, expect: { status: 'ready_to_create', category_code: 'KID', duration_minutes: 45, subject_people_tag: 'Iv' } },
  { name: 'trip two hours', bucket: 'clean', failure_tags: ['field_extraction'], input: { raw_text: 'Trip friday at 6:30p for 2h with Igor' }, expect: { status: 'ready_to_create', category_code: 'TRV', duration_minutes: 120, subject_people_tag: 'Ig' } },
  { name: 'home cleaning category', bucket: 'clean', failure_tags: ['field_extraction'], input: { raw_text: 'Danijela home cleaning saturday at 11:00a for 60 min at home' }, expect: { status: 'ready_to_create', category_code: 'HOME', duration_minutes: 60, padded: false, subject_people_tag: 'D' } },
  { name: 'swim practice kids default duration', bucket: 'clean', failure_tags: ['field_extraction'], input: { raw_text: 'Mila swim practice tomorrow at 4:30p' }, expect: { status: 'ready_to_create', category_code: 'KID', duration_minutes: 60, subject_people_tag: 'M' } },
  { name: 'iso date doctor checkup', bucket: 'clean', failure_tags: ['field_extraction'], input: { raw_text: 'Doctor checkup 2026-04-05 08:15 with Mila' }, expect: { status: 'ready_to_create', category_code: 'MED', duration_minutes: 60, subject_people_tag: 'M' } },
  { name: 'admin paperwork call', bucket: 'clean', failure_tags: ['field_extraction'], input: { raw_text: 'paperwork review thursday at 1:00p with Igor' }, expect: { status: 'ready_to_create', category_code: 'ADM', duration_minutes: 30, subject_people_tag: 'Ig' } },
  { name: 'family concert explicit people', bucket: 'clean', failure_tags: ['field_extraction'], input: { raw_text: 'Mila Iva Louie Igor Danijela concert saturday at 7:00p' }, expect: { status: 'ready_to_create', category_code: 'EVT', duration_minutes: 120, subject_people_tag: 'FAM', logical_color: 'green' } },
  { name: 'house repair at home', bucket: 'clean', failure_tags: ['field_extraction'], input: { raw_text: 'Danijela house repair sunday at 10:00a at home' }, expect: { status: 'ready_to_create', category_code: 'HOME', duration_minutes: 60, padded: false, subject_people_tag: 'D' } },
  { name: 'birthday override single person', bucket: 'clean', failure_tags: ['field_extraction'], input: { raw_text: 'Iva birthday party friday at 5:00p' }, expect: { status: 'ready_to_create', category_code: 'EVT', duration_minutes: 180, subject_people_tag: 'Iv' } },
  { name: 'louie walk default dog', bucket: 'clean', failure_tags: ['field_extraction'], input: { raw_text: 'Louie walk tomorrow at 7:00a' }, expect: { status: 'ready_to_create', category_code: 'DOG', duration_minutes: 60, subject_people_tag: 'L' } },
  { name: 'maps google location preserved', bucket: 'clean', failure_tags: ['field_extraction'], input: { raw_text: 'Mila doctor tomorrow at 3:00p https://www.google.com/maps/place/Clinic' }, expect: { status: 'ready_to_create', category_code: 'MED', duration_minutes: 60, location_prefix: 'https://www.google.com/maps', subject_people_tag: 'M' } },
  { name: 'airport trip early', bucket: 'clean', failure_tags: ['field_extraction'], input: { raw_text: 'Igor airport trip monday at 5:00a' }, expect: { status: 'ready_to_create', category_code: 'TRV', duration_minutes: 120, subject_people_tag: 'Ig' } },
  { name: 'school parent meeting with two people', bucket: 'clean', failure_tags: ['field_extraction'], input: { raw_text: 'school parent meeting wednesday at 18:00 with Iva Danijela' }, expect: { status: 'ready_to_create', category_code: 'KID', duration_minutes: 60, subject_people_tag: 'Iv,D' } },
  { name: 'family event explicit hours', bucket: 'clean', failure_tags: ['field_extraction'], input: { raw_text: 'Mila Iva Louie Igor Danijela family event tomorrow at 12:00p for 3 hours' }, expect: { status: 'ready_to_create', category_code: 'EVT', duration_minutes: 180, subject_people_tag: 'FAM', logical_color: 'green' } },
  { name: 'meeting with iso and duration', bucket: 'clean', failure_tags: ['field_extraction'], input: { raw_text: 'meeting 2026-04-09 16:45 with Igor for 45 min' }, expect: { status: 'ready_to_create', category_code: 'ADM', duration_minutes: 45, subject_people_tag: 'Ig' } },
], 'N-CLEAN');

const normalizeClarify = withIds([
  { name: 'birthday missing time and people', bucket: 'clarification', failure_tags: ['bad_clarification_decision'], input: { raw_text: 'birthday party saturday' }, expect: { status: 'needs_clarification', missing_fields_includes: ['start_time', 'people'] } },
  { name: 'dentist missing time', bucket: 'clarification', failure_tags: ['bad_clarification_decision'], input: { raw_text: 'Mila dentist tomorrow' }, expect: { status: 'needs_clarification', missing_fields_includes: ['start_time'] } },
  { name: 'time only missing title and people', bucket: 'clarification', failure_tags: ['bad_clarification_decision'], input: { raw_text: 'tomorrow at 3pm' }, expect: { status: 'needs_clarification', missing_fields_includes: ['title', 'people'] } },
  { name: 'cal prefix insufficient details', bucket: 'clarification', failure_tags: ['bad_clarification_decision'], input: { raw_text: 'cal: family meeting' }, expect: { status: 'needs_clarification', missing_fields_includes: ['date', 'start_time', 'people'] } },
  { name: 'next week unsupported granularity', bucket: 'clarification', failure_tags: ['bad_clarification_decision'], input: { raw_text: 'kids dentist sometime next week' }, expect: { status: 'needs_clarification', missing_fields_includes: ['date', 'start_time', 'people'] } },
  { name: 'appointment weekday no time', bucket: 'clarification', failure_tags: ['bad_clarification_decision'], input: { raw_text: 'appointment friday with Mila' }, expect: { status: 'needs_clarification', missing_fields_includes: ['start_time'] } },
  { name: 'party missing time only', bucket: 'clarification', failure_tags: ['bad_clarification_decision'], input: { raw_text: 'Mila Iva party tomorrow' }, expect: { status: 'needs_clarification', missing_fields_includes: ['start_time'] } },
  { name: 'louie walk missing date and time', bucket: 'clarification', failure_tags: ['bad_clarification_decision'], input: { raw_text: 'Louie walk' }, expect: { status: 'needs_clarification', missing_fields_includes: ['date', 'start_time'] } },
  { name: 'home cleaning no time', bucket: 'clarification', failure_tags: ['bad_clarification_decision'], input: { raw_text: 'Danijela home cleaning tomorrow' }, expect: { status: 'needs_clarification', missing_fields_includes: ['start_time'] } },
  { name: 'swim practice missing people and time', bucket: 'clarification', failure_tags: ['bad_clarification_decision'], input: { raw_text: 'swim practice saturday' }, expect: { status: 'needs_clarification', missing_fields_includes: ['start_time', 'people'] } },
], 'N-CLAR');

const normalizeRejection = withIds([
  { name: 'all-day medical rejected', bucket: 'rejection_edge', failure_tags: ['deterministic_correctness'], input: { raw_text: 'all-day Mila doctor appointment tomorrow' }, expect: { status: 'rejected', reason_code: 'all_day_not_supported' } },
  { name: 'all day family birthday rejected', bucket: 'rejection_edge', failure_tags: ['deterministic_correctness'], input: { raw_text: 'all day family birthday saturday' }, expect: { status: 'rejected', reason_code: 'all_day_not_supported' } },
  { name: 'all-day school rejected', bucket: 'rejection_edge', failure_tags: ['deterministic_correctness'], input: { raw_text: 'all-day school event friday' }, expect: { status: 'rejected', reason_code: 'all_day_not_supported' } },
  { name: 'all day travel rejected', bucket: 'rejection_edge', failure_tags: ['deterministic_correctness'], input: { raw_text: 'all day travel monday with Igor' }, expect: { status: 'rejected', reason_code: 'all_day_not_supported' } },
  { name: 'all-day vet rejected', bucket: 'rejection_edge', failure_tags: ['deterministic_correctness'], input: { raw_text: 'all-day vet visit for Louie tomorrow' }, expect: { status: 'rejected', reason_code: 'all_day_not_supported' } },
  { name: 'home edge still creates', bucket: 'rejection_edge', failure_tags: ['deterministic_correctness'], input: { raw_text: 'Mila dentist tomorrow at 3pm for 60 min at home' }, expect: { status: 'ready_to_create', category_code: 'MED', duration_minutes: 60, padded: false, subject_people_tag: 'M' } },
  { name: 'apple maps edge location', bucket: 'rejection_edge', failure_tags: ['deterministic_correctness'], input: { raw_text: 'Mila dentist tomorrow at 3pm for 60 min https://maps.apple.com/?q=clinic' }, expect: { status: 'ready_to_create', category_code: 'MED', location_prefix: 'https://maps.apple.com', subject_people_tag: 'M' } },
  { name: 'family birthday edge color', bucket: 'rejection_edge', failure_tags: ['deterministic_correctness'], input: { raw_text: 'Mila Iva Louie Igor Danijela birthday tomorrow at 1pm' }, expect: { status: 'ready_to_create', subject_people_tag: 'FAM', logical_color: 'green', duration_minutes: 180 } },
  { name: 'late night trip crossing day', bucket: 'rejection_edge', failure_tags: ['deterministic_correctness'], input: { raw_text: '2026-04-10 23:30 trip with Igor for 2h' }, expect: { status: 'ready_to_create', category_code: 'TRV', duration_minutes: 120, subject_people_tag: 'Ig' } },
  { name: '24h style meeting edge', bucket: 'rejection_edge', failure_tags: ['deterministic_correctness'], input: { raw_text: 'tomorrow 15:00 meeting with Igor' }, expect: { status: 'ready_to_create', category_code: 'ADM', subject_people_tag: 'Ig' } },
], 'N-EDGE');

const routerStateless = [...routerObvious, ...routerAmbiguous, ...routerAdversarial];
const routerStatefulRows = routerStateful;
const normalizeRows = [...normalizeClean, ...normalizeClarify, ...normalizeRejection];

writeJsonFile(resolveRepoPath('evals/router/fixtures/gold/stateless.json'), routerStateless);
writeJsonFile(resolveRepoPath('evals/router/fixtures/gold/stateful.json'), routerStatefulRows);
writeJsonFile(resolveRepoPath('evals/calendar/fixtures/gold/normalize.json'), normalizeRows);

process.stdout.write(`Wrote router stateless: ${routerStateless.length}\n`);
process.stdout.write(`Wrote router stateful: ${routerStatefulRows.length}\n`);
process.stdout.write(`Wrote normalize: ${normalizeRows.length}\n`);
