'use strict';

const { getConfig } = require('../libs/config.js');

function asText(value) {
  return String(value === undefined || value === null ? '' : value).trim();
}

function toIdSet(values) {
  const list = Array.isArray(values) ? values : [];
  return new Set(list.map((v) => asText(v)).filter(Boolean));
}

function resolveTelegramAccess(input, calendarConfig) {
  const data = input && typeof input === 'object' ? input : {};
  const config = calendarConfig || getConfig().calendar || {};
  const access = config.telegram_access && typeof config.telegram_access === 'object'
    ? config.telegram_access
    : {};

  const enforce = access.enforce_allowlist === true;
  const telegramUserId = asText(
    data.telegram_user_id
      || data.user_id
      || (data.source && data.source.user_id)
  );

  if (!enforce) {
    return {
      enforce: false,
      telegram_user_id: telegramUserId || null,
      calendar_allowed: true,
      pkm_allowed: true,
      reason_code: null,
    };
  }

  if (!telegramUserId) {
    return {
      enforce: true,
      telegram_user_id: null,
      calendar_allowed: false,
      pkm_allowed: false,
      reason_code: 'missing_telegram_user_id',
    };
  }

  const calendarAllowedSet = toIdSet(access.calendar_allowed_user_ids);
  const pkmAllowedSet = toIdSet(access.pkm_allowed_user_ids);
  const pkmAllowed = pkmAllowedSet.has(telegramUserId);
  const calendarAllowed = calendarAllowedSet.has(telegramUserId) || pkmAllowed;

  let reasonCode = null;
  if (!calendarAllowed) reasonCode = 'telegram_user_not_calendar_allowed';
  else if (!pkmAllowed) reasonCode = 'telegram_user_not_pkm_allowed';

  return {
    enforce: true,
    telegram_user_id: telegramUserId,
    calendar_allowed: calendarAllowed,
    pkm_allowed: pkmAllowed,
    reason_code: reasonCode,
  };
}

function pkmAccessMessage(access) {
  if (access && access.reason_code === 'missing_telegram_user_id') {
    return 'PKM access is blocked because Telegram user identity is missing.';
  }
  return 'This Telegram user has calendar-only access. PKM notes are disabled.';
}

function calendarAccessMessage(access) {
  if (access && access.reason_code === 'missing_telegram_user_id') {
    return 'Calendar access is blocked because Telegram user identity is missing.';
  }
  return 'This Telegram user is not allowed to use the family calendar flow.';
}

function applyRouteAccessPolicy(routeResult, access) {
  const route = routeResult && typeof routeResult === 'object' ? routeResult : {};
  const routeName = asText(route.route);
  if (!routeName) return route;
  if (!access || access.enforce !== true) return route;

  if ((routeName === 'pkm_capture' || routeName === 'recipe_search') && !access.pkm_allowed) {
    return {
      route: 'ambiguous',
      confidence: 1,
      clarification_question: pkmAccessMessage(access),
      access_denied_reason: access.reason_code || 'telegram_user_not_pkm_allowed',
    };
  }

  if ((routeName === 'calendar_create' || routeName === 'calendar_query') && !access.calendar_allowed) {
    return {
      route: 'ambiguous',
      confidence: 1,
      clarification_question: calendarAccessMessage(access),
      access_denied_reason: access.reason_code || 'telegram_user_not_calendar_allowed',
    };
  }

  return route;
}

module.exports = {
  resolveTelegramAccess,
  applyRouteAccessPolicy,
  calendarAccessMessage,
};
