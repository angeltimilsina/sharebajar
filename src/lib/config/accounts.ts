import "server-only";

/**
 * Accounts granted by the project owner in code (public wallet addresses
 * only — they still have to prove control by signing in with that wallet).
 * Merged with TREASURY_OWNERS / PRO_COMP_ADDRESSES from the environment.
 */
const env = (k: string) => (process.env[k] ?? "").split(",").map((s) => s.trim()).filter(Boolean);

/** Treasury owners (full admin). */
export const BOOTSTRAP_OWNERS = ["F9XniZpoPEJaR5PUdAp1b9L2DqbAcyvC1fFWhFYB8ZEz"];

/** Complimentary Pro (testing before launch). */
export const PRO_COMP = ["F9XniZpoPEJaR5PUdAp1b9L2DqbAcyvC1fFWhFYB8ZEz", ...env("PRO_COMP_ADDRESSES")];
