#!/usr/bin/env node
/**
 * Validates the Bot Command Center feed before it is committed.
 *
 * Usage: node scripts/validate-feed.mjs [path]   (default: data/asana-fleet.json)
 *
 * Also compares against the committed version (git HEAD) and fails if the task
 * count drops by more than half — the usual sign of a partial Asana pull.
 *
 * Node 20+. No dependencies. Exit 0 = valid, 1 = invalid.
 */

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const PATH = process.argv[2] || 'data/asana-fleet.json';

const MAPPED_STATUS_CS = {
  Idea: [1, 0, 0, 0],
  Building: [1, 1, 0, 0],
  Review: [1, 1, 1, 0],
  Fixing: [1, 1, 1, 0],
  Live: [1, 1, 1, 1]
};
const CLS = { Finance: 'D', Recruitment: 'E', Onboarding: 'E', 'Innovation Lab': 'B', Marketing: 'B' };
const CONNECTORS = [
  'Google Workspace (Virtrify Brain)', 'Asana', 'Slack',
  'Gmail', 'Google Calendar', 'GoHighLevel', 'Fathom / Fireflies'
];
const BOT_KEYS = [
  'id', 'asanaGid', 'name', 'seat', 'dept', 'cat', 'platform', 'owner', 'initials',
  'status', 'statusMapped', 'cls', 'cs', 'locked', 'lastRun', 'subs', 'prompt',
  'conns', 'runs', 'url'
];

const errors = [];
const fail = (msg) => errors.push(msg);
const isStr = (v) => typeof v === 'string' && v.trim().length > 0;
const isPairList = (v, len) => Array.isArray(v) && v.every((r) => Array.isArray(r) && r.length === len);

let feed;
try {
  feed = JSON.parse(readFileSync(PATH, 'utf8'));
} catch (err) {
  console.error(`✗ ${PATH} is not readable JSON: ${err.message}`);
  process.exit(1);
}

/* ----------------------------------------------------------------- source */

for (const k of ['source', 'bots', 'gov', 'activity', 'scheduled']) {
  if (!(k in feed)) fail(`missing top-level key "${k}"`);
}
const { source = {}, bots = [] } = feed;

if (!/^\d{4}-\d{2}-\d{2}$/.test(source.syncedAt || '')) fail('source.syncedAt must be YYYY-MM-DD');
if (!isStr(source.label)) fail('source.label is empty');
if (!isStr(source.project)) fail('source.project is empty');
if (!/^https:\/\/app\.asana\.com\//.test(source.url || '')) fail('source.url must be an Asana URL');
if (source.canon && !isStr(source.canon.version)) fail('source.canon.version is empty');

/* ------------------------------------------------------------------- bots */

if (!Array.isArray(bots) || bots.length === 0) {
  fail('bots must be a non-empty array');
} else {
  const ids = new Set();
  bots.forEach((b, i) => {
    const at = `bots[${i}] (${b?.name || 'unnamed'})`;
    for (const k of BOT_KEYS) if (!(k in b)) fail(`${at}: missing "${k}"`);

    if (b.id !== 'a' + b.asanaGid) fail(`${at}: id must be "a" + asanaGid`);
    if (ids.has(b.id)) fail(`${at}: duplicate id ${b.id}`);
    ids.add(b.id);

    for (const k of ['name', 'dept', 'seat', 'status', 'owner', 'prompt', 'lastRun']) {
      if (!isStr(b[k])) fail(`${at}: "${k}" is empty`);
    }
    if (b.seat !== b.dept) fail(`${at}: seat and dept differ`);
    if (!/^https:\/\//.test(b.url || '')) fail(`${at}: url is not https`);
    if (!Number.isInteger(b.subs) || b.subs < 0) fail(`${at}: subs must be a non-negative integer`);

    const expectedCls = CLS[b.dept] || 'C';
    if (b.cls !== expectedCls) fail(`${at}: cls ${b.cls} should be ${expectedCls} for ${b.dept}`);
    const expectedLocked = (b.platform === 'Viktor' || b.platform === 'GrokBot') && b.cls !== 'A';
    if (b.locked !== expectedLocked) fail(`${at}: locked should be ${expectedLocked}`);

    if (b.statusMapped === true) {
      const cs = MAPPED_STATUS_CS[b.status];
      if (!cs) fail(`${at}: statusMapped but "${b.status}" is not a mapped status`);
      else if (JSON.stringify(b.cs) !== JSON.stringify(cs)) fail(`${at}: cs does not match status ${b.status}`);
    } else if (b.statusMapped === false) {
      if (b.cs !== null) fail(`${at}: unmapped status must have cs: null`);
      const listed = (source.shapeChanges?.unmappedSections || []).some((s) => s.startsWith(b.status));
      if (!listed) fail(`${at}: unmapped status "${b.status}" missing from source.shapeChanges.unmappedSections`);
    } else {
      fail(`${at}: statusMapped must be boolean`);
    }

    const connKeys = Object.keys(b.conns || {});
    if (connKeys.length !== CONNECTORS.length || !CONNECTORS.every((c) => connKeys.includes(c))) {
      fail(`${at}: conns must have exactly the ${CONNECTORS.length} connector keys`);
    } else if (!Object.values(b.conns).every((v) => v === 0 || v === 1)) {
      fail(`${at}: conns values must be 0 or 1`);
    }
    if (!isPairList(b.runs, 2) || b.runs.length === 0) fail(`${at}: runs must be a non-empty list of [what, when]`);
  });

  /* ------------------------------------------------------------- counts */

  const counts = source.counts || {};
  const sections = new Set(bots.map((b) => (b.runs || []).find((r) => r[1] === 'current')?.[0]));
  const departments = new Set(bots.map((b) => b.dept));
  if (counts.tasks !== bots.length) fail(`source.counts.tasks is ${counts.tasks}, bots has ${bots.length}`);
  if (counts.departments !== departments.size) fail(`source.counts.departments is ${counts.departments}, bots span ${departments.size}`);
  if (counts.sections !== sections.size) fail(`source.counts.sections is ${counts.sections}, bots span ${sections.size}`);
}

/* ------------------------------------------------------------- the rest */

if (!isPairList(feed.gov, 5)) fail('gov must be a list of [tool, mark, note, classes, blocked]');
if (!isPairList(feed.activity, 3) || feed.activity.length > 8) fail('activity must be at most 8 [text, when, color] rows');
if (!isPairList(feed.scheduled, 2)) fail('scheduled must be a list of [what, when]');

/* ---------------------------------------------------- partial-pull guard */

try {
  const prev = JSON.parse(execFileSync('git', ['show', `HEAD:${PATH}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
  const before = prev.bots?.length || 0;
  if (before && bots.length < before / 2) {
    fail(`task count dropped from ${before} to ${bots.length} — likely a partial Asana pull`);
  }
} catch {
  // no committed version to compare against
}

if (errors.length) {
  console.error(`✗ ${PATH} failed validation (${errors.length}):`);
  for (const e of errors) console.error('  - ' + e);
  process.exit(1);
}
const byStatus = bots.reduce((a, b) => ({ ...a, [b.status]: (a[b.status] || 0) + 1 }), {});
console.log(`✓ ${PATH} · ${bots.length} agents ·`, byStatus, `· ${bots.filter((b) => b.locked).length} blocked`);
