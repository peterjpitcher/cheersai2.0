import { beforeEach, describe, expect, it, vi } from "vitest";

/** robots.txt and the legacy /auth/signup URL follow the sign-up switch (spec §4.1, P11). */

const switchState = vi.hoisted(() => vi.fn());
vi.mock("@/lib/signup/switch", () => ({ getSelfServeSignupSwitch: () => switchState() }));

const { default: robots } = await import("@/app/robots");
const { default: LegacySignupRedirectPage } = await import("@/app/auth/signup/page");

async function redirectOf(run: () => Promise<unknown>): Promise<{ path: string; status: number }> {
  try {
    await run();
  } catch (error) {
    const parts = ((error as { digest?: string }).digest ?? "").split(";");
    if (parts[0] === "NEXT_REDIRECT") return { path: parts[2], status: Number(parts[3]) };
    throw error;
  }
  throw new Error("expected a redirect");
}

beforeEach(() => switchState.mockReset());

describe("robots.txt", () => {
  it("disallows the whole site while the switch is off, unreadable or on without billing enforcement, as before", async () => {
    for (const state of ["closed", "enforcement_off", "unavailable"]) {
      switchState.mockResolvedValue(state);
      expect(await robots()).toEqual({ rules: [{ userAgent: "*", disallow: "/" }] });
    }
  });

  it("allows the home page and the three legal pages once the switch is on", async () => {
    switchState.mockResolvedValue("open");
    expect(await robots()).toEqual({
      rules: [{ userAgent: "*", allow: ["/$", "/terms", "/privacy", "/data-processing"], disallow: "/" }],
    });
  });
});

describe("/auth/signup", () => {
  it("goes to the login page while the switch is off, unreadable or on without billing enforcement, with a 307", async () => {
    for (const state of ["closed", "enforcement_off", "unavailable"]) {
      switchState.mockResolvedValue(state);
      expect(await redirectOf(() => LegacySignupRedirectPage())).toEqual({ path: "/login", status: 307 });
    }
  });

  it("goes to /signup once the switch is on, with a 307", async () => {
    switchState.mockResolvedValue("open");
    expect(await redirectOf(() => LegacySignupRedirectPage())).toEqual({ path: "/signup", status: 307 });
  });
});
