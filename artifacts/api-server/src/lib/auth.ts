import {
  randomBytes,
  scryptSync,
  timingSafeEqual,
  createHmac,
} from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { eq } from "drizzle-orm";
import { db, usersTable, type User } from "@workspace/db";
import type { NotificationChannel, PendingVerifications } from "@workspace/db";

const SCRYPT_KEYLEN = 64;
const COOKIE_NAME = "autocare_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function sessionSecret(): string {
  const s = process.env["SESSION_SECRET"];
  if (!s) throw new Error("SESSION_SECRET is required");
  return s;
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const hashBuf = Buffer.from(hash, "hex");
  const candidate = scryptSync(password, salt, hashBuf.length);
  if (candidate.length !== hashBuf.length) return false;
  return timingSafeEqual(candidate, hashBuf);
}

type SessionPayload = { uid: string; iat: number };

function sign(payload: SessionPayload): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const mac = createHmac("sha256", sessionSecret())
    .update(body)
    .digest("base64url");
  return `${body}.${mac}`;
}

/**
 * Mint a fresh signed session token for the given user ID. Wire format is
 * identical to the value of the `autocare_session` cookie — mobile clients
 * persist this token and send it via `Authorization: Bearer <token>` so
 * `loadUser` accepts it interchangeably with the cookie. Returned in the
 * JSON body of /auth/login and /auth/signup (auto-login flavour) so mobile
 * apps can grab it without parsing Set-Cookie.
 */
export function signSessionToken(userId: string): string {
  return sign({ uid: userId, iat: Date.now() });
}

function verify(token: string): SessionPayload | null {
  const [body, mac] = token.split(".");
  if (!body || !mac) return null;
  const expected = createHmac("sha256", sessionSecret())
    .update(body)
    .digest("base64url");
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(body, "base64url").toString("utf8"),
    ) as SessionPayload;
    if (Date.now() - payload.iat > SESSION_TTL_MS) return null;
    return payload;
  } catch {
    return null;
  }
}

export function issueSessionCookie(res: Response, userId: string): void {
  const token = sign({ uid: userId, iat: Date.now() });
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env["NODE_ENV"] === "production",
    sameSite: "lax",
    maxAge: SESSION_TTL_MS,
    path: "/",
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(COOKIE_NAME, { path: "/" });
}

/**
 * Public-safe shape of a user row. We must strip both `passwordHash` AND
 * `pendingVerifications` before sending the row to any client — the
 * latter contains hashed verification codes that, given the tiny 6-digit
 * search space and unsalted SHA-256, would be trivially recoverable
 * offline and let an attacker complete signup verification without
 * controlling the email or phone we sent the code to. We expose the
 * derived `pendingVerificationChannels` list instead so the client knows
 * what still needs verifying.
 */
export type AuthedUser = Omit<User, "passwordHash" | "pendingVerifications"> & {
  pendingVerificationChannels: NotificationChannel[];
};

export function toAuthedUser(row: User): AuthedUser {
  const {
    passwordHash: _ph,
    pendingVerifications,
    ...rest
  } = row;
  const selected = (row.notificationChannels ?? ["email", "whatsapp"]) as
    | NotificationChannel[]
    | readonly NotificationChannel[];
  const pendingChannels = (selected as NotificationChannel[]).filter((c) => {
    const verifiedAt =
      c === "email" ? row.emailVerifiedAt : row.phoneVerifiedAt;
    return !verifiedAt;
  });
  void pendingVerifications;
  return { ...rest, pendingVerificationChannels: pendingChannels };
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthedUser;
    }
  }
}

function readBearerToken(req: Request): string | null {
  const h = req.headers["authorization"];
  if (typeof h !== "string") return null;
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m && m[1] ? m[1].trim() : null;
}

async function loadUser(req: Request): Promise<AuthedUser | null> {
  const cookieToken = (req as Request & { cookies?: Record<string, string> }).cookies?.[
    COOKIE_NAME
  ];
  // Cookie wins (web), Bearer header is the mobile fallback. Both carry the
  // same signed session payload.
  const token = cookieToken ?? readBearerToken(req);
  if (!token) return null;
  const payload = verify(token);
  if (!payload) return null;
  const [row] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, payload.uid));
  if (!row || !row.active) return null;
  return toAuthedUser(row);
}

export async function attachUser(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const u = await loadUser(req);
    if (u) req.user = u;
  } catch {
    // ignore — treat as anonymous
  }
  next();
}

export function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!req.user) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  next();
}

export function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!req.user) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  if (req.user.role !== "admin" && req.user.role !== "super_admin") {
    res.status(403).json({ error: "Admin only" });
    return;
  }
  next();
}

export function requireSuperAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!req.user) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  if (req.user.role !== "super_admin") {
    res.status(403).json({ error: "Super admin only" });
    return;
  }
  next();
}
