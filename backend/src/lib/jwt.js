import jwt from "jsonwebtoken";

const SECRET = process.env.JWT_SECRET;
const EXPIRES_IN = process.env.JWT_EXPIRES_IN || "8h";

if (!SECRET) {
  throw new Error("JWT_SECRET is not set. Copy backend/.env.example to backend/.env and set it.");
}
// Short/guessable secrets make every issued token forgeable. 32 chars is a
// floor, not a target — generate with `openssl rand -base64 48` or similar.
if (SECRET.length < 32) {
  throw new Error("JWT_SECRET is too short (need 32+ random characters). Generate one with: openssl rand -base64 48");
}

export function signToken(payload) {
  return jwt.sign(payload, SECRET, { expiresIn: EXPIRES_IN });
}

export function verifyToken(token) {
  return jwt.verify(token, SECRET);
}
