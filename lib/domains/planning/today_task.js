'use strict';

// Today-task value validation and error construction. Date parsing remains
// delegated to the business-timezone module while API errors retain stable
// status and code fields.

function defaultError(statusCode, message, code = '') {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (code) error.code = code;
  return error;
}

function todayTaskError(statusCode, message, code = 'TODAY_TASK_INVALID', options = {}) {
  return (options.error || defaultError)(statusCode, message, code);
}

function normalizeTodayTaskDate(input, options = {}) {
  const parseBusinessDateTime = options.parseBusinessDateTime || (value => value);
  return parseBusinessDateTime(input);
}

module.exports = Object.freeze({
  todayTaskError,
  normalizeTodayTaskDate,
});