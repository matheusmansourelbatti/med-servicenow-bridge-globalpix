import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkBasicAuth } from '../src/basic-auth.js';

const header = (u, p) => 'Basic ' + Buffer.from(`${u}:${p}`).toString('base64');

test('accepts correct basic credentials', () => {
  assert.equal(checkBasicAuth(header('servicenow', 's3cret:with:colons'), 'servicenow', 's3cret:with:colons'), true);
});

test('rejects wrong or missing credentials', () => {
  assert.equal(checkBasicAuth(header('servicenow', 'nope'), 'servicenow', 's3cret'), false);
  assert.equal(checkBasicAuth(header('other', 's3cret'), 'servicenow', 's3cret'), false);
  assert.equal(checkBasicAuth(undefined, 'servicenow', 's3cret'), false);
  assert.equal(checkBasicAuth('Bearer abc', 'servicenow', 's3cret'), false);
});
