const test = require('node:test');
const assert = require('node:assert/strict');
const { validateJwtSecrets, validateOwnerCredentials } = require('../dist/security.js');

test('JWT secrets must be separate, non-placeholder, and at least 32 characters', () => {
  const access = 'Yj4Vt0bW8pQ2fN6xK1mR9cL3sA7dE5hG';
  const refresh = 'P8zM2wH6qT1vC5nJ9xF3bR7kL0sD4aE6';
  assert.deepEqual(validateJwtSecrets(access, refresh), { access, refresh });
  assert.throws(() => validateJwtSecrets('short', refresh), /at least 32 characters/);
  assert.throws(() => validateJwtSecrets('replace-with-a-long-random-secret', refresh), /at least 32 characters/);
  assert.throws(() => validateJwtSecrets(access, access), /must be different values/);
});

test('initial owner credentials are required and sample credentials are refused', () => {
  assert.deepEqual(validateOwnerCredentials('Owner@factory.in', 'A-long-unique-password-482'), {
    email: 'owner@factory.in', password: 'A-long-unique-password-482',
  });
  assert.throws(() => validateOwnerCredentials(undefined, undefined), /are required/);
  assert.throws(() => validateOwnerCredentials('owner@example.com', 'A-long-unique-password-482'), /template address/);
  assert.throws(() => validateOwnerCredentials('owner@factory.in', 'replace-with-at-least-12-characters'), /non-template password/);
  assert.throws(() => validateOwnerCredentials('owner@factory.in', 'short'), /12 and 72 characters/);
  assert.throws(() => validateOwnerCredentials('owner@factory.in', 'é'.repeat(37)), /72 UTF-8 bytes/);
});
