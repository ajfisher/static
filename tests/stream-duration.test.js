import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { STREAM_MAX_PREPARE_MINUTES, validatePrepareMinutes } from '../opus-stream.js';

test('long listening test permits 30 minutes of foreground preparation', () => {
  assert.equal(STREAM_MAX_PREPARE_MINUTES, 30);
  for (const minutes of [1, 3, 10, 30]) assert.equal(validatePrepareMinutes(minutes), minutes);
});

test('preparation rejects excessively long or malformed requests', () => {
  for (const minutes of [0, -1, 31, 45, 1.5, NaN, Infinity, '30']) {
    assert.throws(() => validatePrepareMinutes(minutes), /Choose 1 to 30 minutes/);
  }
});
