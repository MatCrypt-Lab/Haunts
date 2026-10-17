/**
 * Crew invite links opened before sign-in or onboarding finish cannot reach the join screen
 * (it is protected), so the code is held here until the main app is ready.
 */
let pending: string | null = null;

export function inviteCodeFromUrl(url: string | null): string | null {
  const m = url?.match(/join\/([A-Za-z0-9]{6,8})(?:[/?#]|$)/);
  return m ? m[1]!.toUpperCase() : null;
}

export function holdInvite(code: string): void {
  pending = code;
}

export function takeInvite(): string | null {
  const c = pending;
  pending = null;
  return c;
}
