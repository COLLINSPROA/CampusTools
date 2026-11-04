import { browserSupportsWebAuthn, startAuthentication, startRegistration } from '@simplewebauthn/browser';
import { supabase } from './supabase.js';

async function invoke(action, values = {}) {
  const { data, error } = await supabase.functions.invoke('passkeys', {
    body: { action, ...values }
  });
  if (error?.name === 'FunctionsFetchError') {
    throw new Error('Could not reach the passkeys Edge Function. Confirm it is deployed, its required WEBAUTHN secrets are set, and WEBAUTHN_ORIGIN exactly matches this site origin.');
  }
  if (error) throw error;
  return data;
}

export function passkeysSupported() {
  return browserSupportsWebAuthn();
}

export async function listPasskeys() {
  const { credentials } = await invoke('list');
  return credentials;
}

export async function authenticateWithPasskey() {
  const { challengeId, options } = await invoke('authentication-options');
  const response = await startAuthentication({ optionsJSON: options });
  await invoke('authentication-verify', { challengeId, response });
}

export async function registerPasskey(name) {
  const { challengeId, options } = await invoke('registration-options', { name });
  const response = await startRegistration({ optionsJSON: options });
  await invoke('registration-verify', { challengeId, response, name });
}

export async function removePasskey(credentialId) {
  await invoke('remove', { credentialId });
}

export async function hasVerifiedSecondFactor() {
  const { verified } = await invoke('status');
  return verified;
}
