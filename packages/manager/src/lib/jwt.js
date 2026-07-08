/**
 * Minimal JWT signing over node:crypto — no jsonwebtoken dependency. Two
 * consumers: the Firestore REST client (RS256 service-account bearer
 * grants) and the App Store Connect client (ES256 with a `kid` header).
 * ES256 signatures must use the raw JOSE r||s format, not ASN.1/DER —
 * hence the ieee-p1363 dsaEncoding (ignored for RSA keys, so it's safe
 * to set unconditionally).
 */
const { createSign } = require('node:crypto');

/**
 * Sign a compact JWT.
 *
 * @param {Object} header - JOSE header ({ alg, typ, kid? })
 * @param {Object} payload - JWT claims
 * @param {string} privateKey - PEM private key (RSA for RS256, EC P-256 for ES256)
 * @returns {string} - Compact JWT (header.payload.signature)
 */
function signJwt(header, payload, privateKey) {
  const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signingInput = `${encodedHeader}.${encodedPayload}`;

  const signer = createSign('SHA256');
  signer.update(signingInput);
  const signature = signer.sign({ key: privateKey, dsaEncoding: 'ieee-p1363' }, 'base64url');

  return `${signingInput}.${signature}`;
}

module.exports = { signJwt };
