// Tests for the MSAL cache-corruption detector that drives the
// `pac-cache-corrupt` ProxyError branch in dataverse-proxy.ts.
//
// The detector is the only thing distinguishing "tell user to run
// `pac auth create`" from "tell user to run `pac auth clear` first" —
// silent regressions here put colleagues back into the original
// frustrating loop (running `pac auth create` repeatedly, the cache
// stays corrupt, MSAL keeps throwing). Pure function, easy to lock.

import { isMsalCacheCorruptError } from './dataverse-proxy';

describe('isMsalCacheCorruptError', () => {
  it('returns false for null / undefined / non-objects', () => {
    expect(isMsalCacheCorruptError(null)).toBe(false);
    expect(isMsalCacheCorruptError(undefined)).toBe(false);
    expect(isMsalCacheCorruptError('multiple_matching_appMetadata')).toBe(false);
    expect(isMsalCacheCorruptError(42)).toBe(false);
  });

  it('detects errorCode "multiple_matching_appMetadata"', () => {
    expect(isMsalCacheCorruptError({ errorCode: 'multiple_matching_appMetadata' })).toBe(true);
  });

  it('detects errorCode "multiple_matching_tokens"', () => {
    expect(isMsalCacheCorruptError({ errorCode: 'multiple_matching_tokens' })).toBe(true);
  });

  it('detects errorCode "multiple_matching_accounts"', () => {
    expect(isMsalCacheCorruptError({ errorCode: 'multiple_matching_accounts' })).toBe(true);
  });

  it('detects the same codes from the .message field (MSAL Node prefixes the code)', () => {
    const realWorld =
      'multiple_matching_appMetadata: See https://aka.ms/msal.js/errors#multiple_matching_appmetadata for details';
    expect(isMsalCacheCorruptError({ message: realWorld })).toBe(true);
  });

  it('also works against a real Error instance', () => {
    class FakeMsalError extends Error {
      errorCode = 'multiple_matching_appMetadata';
    }
    expect(isMsalCacheCorruptError(new FakeMsalError('boom'))).toBe(true);
  });

  it('returns false for unrelated errors (network, invalid_grant, etc.)', () => {
    expect(isMsalCacheCorruptError({ errorCode: 'invalid_grant', message: 'token expired' })).toBe(false);
    expect(isMsalCacheCorruptError({ message: 'ENETUNREACH' })).toBe(false);
    expect(isMsalCacheCorruptError(new Error('regular error'))).toBe(false);
  });

  it('does not match a partial / unrelated code containing "multiple"', () => {
    expect(isMsalCacheCorruptError({ errorCode: 'multiple_authority_not_supported' })).toBe(false);
    expect(isMsalCacheCorruptError({ message: 'multiple_authority_not_supported: ...' })).toBe(false);
  });
});
