const { test } = require('node:test');
const assert = require('node:assert/strict');
const { verifyGoogleCredential } = require('../lib/google-auth');

test('Google verification pins audience and checks nonce and verified identity', async () => {
  const payload = { sub: 'google-subject', name: 'Gabriel', nonce: 'connection-nonce', email_verified: true };
  const client = { verifyIdToken: async options => {
    assert.deepEqual(options, { idToken: 'signed-token', audience: 'our-client' });
    return { getPayload: () => payload };
  } };
  assert.deepEqual(await verifyGoogleCredential('signed-token', 'our-client', 'connection-nonce', client), { sub: 'google-subject', name: 'Gabriel' });
  await assert.rejects(verifyGoogleCredential('signed-token', 'our-client', 'other-connection', client));
  payload.email_verified = false;
  await assert.rejects(verifyGoogleCredential('signed-token', 'our-client', 'connection-nonce', client));
  await assert.rejects(verifyGoogleCredential('signed-token', '', 'connection-nonce', client));
});

test('Google signature/expiry verification errors reject login', async () => {
  await assert.rejects(verifyGoogleCredential('forged-token', 'our-client', 'nonce', {
    verifyIdToken: async () => { throw new Error('Invalid signature'); }
  }));
});
