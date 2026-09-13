import { describe, expect, it } from "vitest";
import { ADMIN_SESSION_COOKIE, adminCookieHeader, clearAdminCookieHeader, issueAdminSession, parseCookie, verifyAdminSession } from "../../src/security/admin-session";

const SECRET = "test-admin-secret";
const NOW = 1_000_000;

describe("admin session cookie", () => {
  it("issues a signed session that verifies until expiry", () => {
    const token = issueAdminSession(SECRET, NOW, 60_000);
    expect(verifyAdminSession(SECRET, token, NOW + 30_000)).toBe(true);
    expect(verifyAdminSession(SECRET, token, NOW + 61_000)).toBe(false);
  });

  it("rejects tampered or foreign sessions", () => {
    const token = issueAdminSession(SECRET, NOW, 60_000);
    expect(verifyAdminSession(SECRET, `${token}x`, NOW)).toBe(false);
    expect(verifyAdminSession("other-secret", token, NOW)).toBe(false);
    expect(verifyAdminSession(SECRET, null, NOW)).toBe(false);
    expect(verifyAdminSession(SECRET, "not-a-token", NOW)).toBe(false);
  });

  it("sets HttpOnly/Secure/SameSite=Strict and clears on logout", () => {
    const header = adminCookieHeader(issueAdminSession(SECRET, NOW));
    expect(header).toContain(`${ADMIN_SESSION_COOKIE}=`);
    expect(header).toContain("HttpOnly");
    expect(header).toContain("Secure");
    expect(header).toContain("SameSite=Strict");
    expect(header).toContain("Path=/api/live");
    expect(clearAdminCookieHeader()).toContain("Max-Age=0");
  });

  it("parses the cookie header safely", () => {
    expect(parseCookie("a=1; tc_admin=abc.def; b=2", ADMIN_SESSION_COOKIE)).toBe("abc.def");
    expect(parseCookie(undefined, ADMIN_SESSION_COOKIE)).toBeNull();
    expect(parseCookie("other=1", ADMIN_SESSION_COOKIE)).toBeNull();
  });
});
