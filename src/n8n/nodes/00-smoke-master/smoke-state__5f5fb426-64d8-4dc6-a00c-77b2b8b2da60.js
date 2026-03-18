'use strict';

function asText(value) {
  return String(value === undefined || value === null ? '' : value).trim();
}

function cloneResults(value) {
  return Array.isArray(value) ? value.map((row) => ({ ...(row || {}) })) : [];
}

function readNodeJson($items, nodeName) {
  if (typeof $items !== 'function' || !asText(nodeName)) return {};
  try {
    const rows = $items(nodeName, 0, 0);
    if (Array.isArray(rows) && rows[0] && rows[0].json && typeof rows[0].json === 'object') {
      return { ...rows[0].json };
    }
  } catch (_err) {
    return {};
  }
  return {};
}

function mergeSmokeState(priorState, currentState) {
  const prior = priorState && typeof priorState === 'object' ? priorState : {};
  const current = currentState && typeof currentState === 'object' ? currentState : {};

  return {
    ...prior,
    ...current,
    results: cloneResults(prior.results),
    artifacts: {
      ...(prior.artifacts && typeof prior.artifacts === 'object' ? prior.artifacts : {}),
      ...(current.artifacts && typeof current.artifacts === 'object' ? current.artifacts : {}),
    },
  };
}

function collectEntryIds(...values) {
  const ids = new Set();
  const stack = [...values];
  const seen = new Set();
  const keyedLists = [
    'entry_ids',
    'created_entry_ids',
  ];
  const keyedSingles = [
    'entry_id',
    'telegram_capture_entry_id',
    'email_capture_entry_id',
  ];

  while (stack.length) {
    const current = stack.pop();
    if (current == null) continue;

    if (Array.isArray(current)) {
      current.forEach((value) => stack.push(value));
      continue;
    }

    if (typeof current !== 'object') continue;
    if (seen.has(current)) continue;
    seen.add(current);

    keyedSingles.forEach((key) => {
      const value = current[key];
      if (Number.isFinite(Number(value)) && Number(value) > 0) {
        ids.add(Number(value));
      }
    });

    keyedLists.forEach((key) => {
      const value = current[key];
      if (!Array.isArray(value)) return;
      value.forEach((entryId) => {
        if (Number.isFinite(Number(entryId)) && Number(entryId) > 0) {
          ids.add(Number(entryId));
        }
      });
    });

    Object.keys(current).forEach((key) => {
      if (keyedSingles.includes(key) || keyedLists.includes(key)) return;
      stack.push(current[key]);
    });
  }

  return Array.from(ids).sort((a, b) => a - b);
}

module.exports = {
  asText,
  cloneResults,
  collectEntryIds,
  mergeSmokeState,
  readNodeJson,
};
