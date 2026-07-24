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

  if (name === 'sales_match') {
    if (!Array.isArray(context.candidateEmployeeIds)) {
      return { ok: false, errors: ['server candidate employee IDs are required'] };
    }
    if (context.candidateEmployeeIds.some(employeeId => !Number.isInteger(employeeId) || employeeId <= 0)) {
      return { ok: false, errors: ['server candidate employee IDs must contain only positive integers'] };
    }
    const allowedCandidates = new Set(context.candidateEmployeeIds);
    const inventedCandidate = value.rankedCandidates.find(candidate => !allowedCandidates.has(candidate.employeeId));
    if (inventedCandidate) {
      return { ok: false, errors: [`candidate employee ${inventedCandidate.employeeId} is not allowed`] };
    }
    const rankedIds = value.rankedCandidates.map(candidate => candidate.employeeId);
    if (new Set(rankedIds).size !== rankedIds.length) {
      return { ok: false, errors: ['candidate employee IDs must be unique'] };
    }
  }

  return { ok: true, value: deepFreeze(clone(value)) };
}

module.exports = { validateStationOutput };
