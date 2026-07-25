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

function hasChinese(value) {
  return /[\u3400-\u9fff]/u.test(String(value || ''));
}

function employeeFacingText(name, value) {
  if (name === 'distribution_priority') return value.blockingReasons || [];
  if (name === 'sales_match') return (value.rankedCandidates || []).flatMap(candidate => candidate.reasons || []);
  if (name === 'sales_pack') return [value.summary, ...(value.entryPoints || []), ...(value.risks || [])];
  if (name === 'action_proposal') return [value.summary, value.nextAction].filter(Boolean);
  if (name === 'next_action') return [value.nextAction, value.reason].filter(Boolean);
  if (name === 'manager_anomaly') return [value.explanation, value.interventionSuggestion];
  return [];
}

function isEmployeeFacingChinese(name, value) {
  return employeeFacingText(name, value).every(hasChinese);
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
  if (!isEmployeeFacingChinese(name, value)) {
    return { ok: false, errors: ['employee-facing AI text must be written in Simplified Chinese'] };
  }

  if (name === 'contact_readiness') {
    if (!Array.isArray(context.contactIds)) {
      return { ok: false, errors: ['server contact IDs are required'] };
    }
    if (context.contactIds.some(contactId => typeof contactId !== 'string' || !contactId.trim())) {
      return { ok: false, errors: ['server contact IDs must contain only non-empty strings'] };
    }
    const allowedContacts = new Set(context.contactIds);
    const inventedContact = value.contactIds.find(contactId => !allowedContacts.has(contactId));
    if (inventedContact) return { ok: false, errors: [`contact ${inventedContact} is not allowed`] };
    if (value.readiness === 'ready' && !value.contactIds.length) {
      return { ok: false, errors: ['ready contact readiness requires at least one contact ID'] };
    }
  }

  if (name === 'sales_match') {
    if (!Array.isArray(context.candidateEmployeeIds)) {
      return { ok: false, errors: ['server candidate employee IDs are required'] };
    }
    if (Array.from(context.candidateEmployeeIds).some(employeeId => !Number.isInteger(employeeId) || employeeId <= 0)) {
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

  if (name === 'manager_anomaly') {
    const constraints = [
      ['anomalyIds', value.anomalyId, 'anomaly'],
      ['anomalyCodes', value.anomalyCode, 'anomaly code'],
      ['customerIds', value.customerId, 'customer'],
    ];
    for (const [key, selected, label] of constraints) {
      if (!Array.isArray(context[key]) || !context[key].length) {
        return { ok: false, errors: [`server ${key} are required`] };
      }
      if (!context[key].includes(selected)) {
        return { ok: false, errors: [`${label} ${selected} is not allowed`] };
      }
    }
  }

  return { ok: true, value: deepFreeze(clone(value)) };
}

module.exports = { isEmployeeFacingChinese, validateStationOutput };
