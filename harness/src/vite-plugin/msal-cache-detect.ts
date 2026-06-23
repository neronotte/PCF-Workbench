/**
 * Pure detector for MSAL Node "cache is corrupt / ambiguous" errors. Kept in
 * its own file (zero imports) so unit tests can load it without dragging in
 * `@azure/msal-node` → `keytar`, which requires `libsecret-1.so.0` on Linux CI
 * runners.
 *
 * These errors manifest when PAC's token cache has multiple entries the lookup
 * can't disambiguate (e.g. after a PAC version bump or repeated
 * `pac auth create` runs against the same org). The only reliable fix is
 * `pac auth clear`, since the bad appMetadata / token / account entries
 * persist even after deleting the matching `pac auth` profile.
 *
 * See https://aka.ms/msal.js/errors#multiple_matching_appmetadata
 */
export function isMsalCacheCorruptError(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false;
  const errorCode = (e as { errorCode?: unknown }).errorCode;
  const message = (e as { message?: unknown }).message;
  const codes = ['multiple_matching_appMetadata', 'multiple_matching_tokens', 'multiple_matching_accounts'];
  if (typeof errorCode === 'string' && codes.includes(errorCode)) return true;
  if (typeof message === 'string') {
    for (const c of codes) if (message.includes(c)) return true;
  }
  return false;
}
