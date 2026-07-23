'use strict';

const Ajv = require('ajv');
const { getStation } = require('./prompt_registry');

const ajv = new Ajv({ allErrors: true, strict: true });
const validators = new Map();

function clone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function validationErrors(validate) {
  return (validate.errors || []).map(error => `${error.instancePath || '/'} ${error.message}`);
}

function validatorFor(name, version) {
  const key = `${name}@${version}`;
  if (!validators.has(key)) validators.set(key, ajv.compile(getStation(name, version).schema));
  return validators.get(key);
}

function validateStationOutput(name, version, value, context = {}) {
  let validate;
  try {
    validate = validatorFor(name, version);
  } catch (error) {
    return { ok: false, errors: [error.message] };
  }
  if (!Array.isArray(context.evidenceIds)) return { ok: false, errors: ['server evidence IDs are required'] };
  if (!validate(value)) return { ok: false, errors: validationErrors(validate) };

  const allowedEvidence = new Set(context.evidenceIds);
  const inventedEvidence = value.evidenceIds.find(evidenceId => !allowedEvidence.has(evidenceId));
  if (inventedEvidence) return { ok: false, errors: [`evidence ${inventedEvidence} is not allowed`] };

  return { ok: true, value: deepFreeze(clone(value)) };
}

module.exports = { validateStationOutput };
