const { OAuth2Client } = require('google-auth-library');
const verifier = new OAuth2Client();

async function verifyGoogleCredential(credential, clientId, nonce, client = verifier) {
  if (!clientId || typeof credential !== 'string' || credential.length > 12000 || !nonce) {
    throw new Error('Google login unavailable');
  }
  const ticket = await client.verifyIdToken({ idToken: credential, audience: clientId });
  const payload = ticket.getPayload();
  if (!payload || typeof payload.sub !== 'string' || !payload.sub || payload.nonce !== nonce || !payload.email_verified) {
    throw new Error('Invalid Google identity');
  }
  return { sub: payload.sub, name: typeof payload.name === 'string' ? payload.name : 'Jogador' };
}

module.exports = { verifyGoogleCredential };
