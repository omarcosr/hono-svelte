import type { Context } from "hono";
import { getCookie } from "hono/cookie";

export const SESSION_COOKIE = "hono_demo_session";
export const SESSION_VALUE = "authenticated";

export function hasSession(c: Context): boolean {
  const cookie = getCookie(c, SESSION_COOKIE);
  return cookie === SESSION_VALUE;
}
