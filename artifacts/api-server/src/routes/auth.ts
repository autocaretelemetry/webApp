import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { LoginBody } from "@workspace/api-zod";
import {
  verifyPassword,
  issueSessionCookie,
  clearSessionCookie,
} from "../lib/auth";

const router: IRouter = Router();

router.post("/auth/login", async (req, res): Promise<void> => {
  const parsed = LoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const email = parsed.data.email.trim().toLowerCase();
  const [row] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, email));
  if (!row || !row.active) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }
  if (!verifyPassword(parsed.data.password, row.passwordHash)) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }
  issueSessionCookie(res, row.id);
  const { passwordHash: _ph, ...safe } = row;
  res.json(safe);
});

router.post("/auth/logout", (_req, res): void => {
  clearSessionCookie(res);
  res.status(204).end();
});

router.get("/auth/me", (req, res): void => {
  if (!req.user) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  res.json(req.user);
});

export default router;
