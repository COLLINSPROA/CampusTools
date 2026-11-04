import { createClient } from 'npm:@supabase/supabase-js@2.49.1';
import {
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from 'npm:@simplewebauthn/server@13.2.2';

const supabaseUrl = Deno.env.get('SUPABASE_URL');
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const rpId = Deno.env.get('WEBAUTHN_RP_ID');
const expectedOrigin = Deno.env.get('WEBAUTHN_ORIGIN');

if (!supabaseUrl || !serviceRoleKey || !rpId || !expectedOrigin) {
  throw new Error('Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, WEBAUTHN_RP_ID and WEBAUTHN_ORIGIN for the passkey-login function.');
}

const originUrl = new URL(expectedOrigin);
if (
  originUrl.origin !== expectedOrigin ||
  originUrl.hostname !== rpId && !originUrl.hostname.endsWith(`.${rpId}`) ||
  originUrl.protocol !== 'https:' && !(originUrl.protocol === 'http:' && originUrl.hostname === 'localhost')
) {
  throw new Error('Configure WEBAUTHN_ORIGIN as a secure origin matching WEBAUTHN_RP_ID.');
}

const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const challengeLifetimeMs = 3 * 60 * 1000;
const loginTicketLifetimeMs = 60 * 1000;

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function json(request: Request, body: unknown, status = 200) {
  const headers = new Headers({
    'content-type': 'application/json',
    'vary': 'Origin',
  });
  if (request.headers.get('origin') === expectedOrigin) {
    headers.set('access-control-allow-origin', expectedOrigin);
    headers.set('access-control-allow-headers', 'authorization, apikey, content-type, x-client-info');
    headers.set('access-control-allow-methods', 'POST, OPTIONS');
  }
  return new Response(JSON.stringify(body), { status, headers });
}

function base64UrlToBytes(value: string) {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - base64.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function hashText(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return bytesToBase64Url(new Uint8Array(digest));
}

async function enforceRateLimit(request: Request) {
  const requesterIp = request.headers.get('cf-connecting-ip')
    || request.headers.get('x-forwarded-for')?.split(',')[0].trim()
    || request.headers.get('x-real-ip')
    || 'unknown';
  const { data, error } = await admin.rpc('consume_passkey_login_rate_limit', {
    p_requester_hash: await hashText(requesterIp),
  });
  if (error) throw error;
  if (data !== true) throw new HttpError(429, 'Too many passkey attempts. Wait a minute and try again.');
}

async function cleanupExpiredRecords() {
  const now = new Date().toISOString();
  const [challenges, tickets] = await Promise.all([
    admin.from('passkey_login_challenges').delete().lt('expires_at', now),
    admin.from('passkey_login_tickets').delete().lt('expires_at', now),
  ]);
  if (challenges.error) throw challenges.error;
  if (tickets.error) throw tickets.error;
}

async function createOptions() {
  const options = await generateAuthenticationOptions({
    rpID: rpId,
    userVerification: 'required',
    timeout: challengeLifetimeMs,
  });
  const { data, error } = await admin.from('passkey_login_challenges').insert({
    challenge: options.challenge,
    expires_at: new Date(Date.now() + challengeLifetimeMs).toISOString(),
  }).select('id').single();
  if (error) throw error;
  return { challengeId: data.id, options };
}

async function verifyPasskey(body: Record<string, unknown>) {
  if (typeof body.challengeId !== 'string' || !body.response || typeof body.response !== 'object') {
    throw new HttpError(400, 'Invalid passkey response. Start again.');
  }
  const response = body.response as { id?: unknown };
  if (typeof response.id !== 'string') throw new HttpError(400, 'Invalid passkey response. Start again.');

  const { data: challenge, error: challengeError } = await admin
    .from('passkey_login_challenges')
    .update({ consumed_at: new Date().toISOString() })
    .eq('id', body.challengeId)
    .is('consumed_at', null)
    .gt('expires_at', new Date().toISOString())
    .select('challenge')
    .maybeSingle();
  if (challengeError) throw challengeError;
  if (!challenge) throw new HttpError(400, 'This passkey request expired. Start again.');

  const { data: credential, error: credentialError } = await admin
    .from('passkey_credentials')
    .select('credential_id, user_id, public_key, sign_count, transports')
    .eq('credential_id', response.id)
    .maybeSingle();
  if (credentialError) throw credentialError;
  if (!credential) throw new HttpError(401, 'No matching passkey was found. Use your password or register a passkey after signing in.');

  const verification = await verifyAuthenticationResponse({
    response: body.response as Parameters<typeof verifyAuthenticationResponse>[0]['response'],
    expectedChallenge: challenge.challenge,
    expectedOrigin,
    expectedRPID: rpId,
    credential: {
      id: credential.credential_id,
      publicKey: base64UrlToBytes(credential.public_key),
      counter: Number(credential.sign_count),
      transports: credential.transports,
    },
    requireUserVerification: true,
  }).catch(() => null);
  if (!verification?.verified) {
    throw new HttpError(401, 'Passkey verification failed. Use your password or try again.');
  }

  const { data: updatedCredential, error: updateError } = await admin
    .from('passkey_credentials')
    .update({
      sign_count: verification.authenticationInfo.newCounter,
      last_used_at: new Date().toISOString(),
    })
    .eq('credential_id', credential.credential_id)
    .eq('user_id', credential.user_id)
    .eq('sign_count', credential.sign_count)
    .select('credential_id')
    .maybeSingle();
  if (updateError) throw updateError;
  if (!updatedCredential) throw new HttpError(409, 'This passkey was used in another request. Try again.');

  const { data: userData, error: userError } = await admin.auth.admin.getUserById(credential.user_id);
  if (userError) throw userError;
  const user = userData.user;
  if (!user.email || (!user.email_confirmed_at && !user.confirmed_at)) {
    throw new HttpError(401, 'This passkey cannot sign in right now. Use your password or contact support.');
  }

  const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: user.email,
    options: { redirectTo: expectedOrigin },
  });
  if (linkError) throw linkError;
  const tokenHash = linkData.properties.hashed_token;
  if (!tokenHash) throw new Error('Supabase did not return a magic-link token hash.');

  const loginTicket = bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)));
  const { error: ticketError } = await admin.from('passkey_login_tickets').insert({
    token_hash: await hashText(loginTicket),
    user_id: user.id,
    expires_at: new Date(Date.now() + loginTicketLifetimeMs).toISOString(),
  });
  if (ticketError) throw ticketError;

  return { tokenHash, loginTicket };
}

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return json(request, { ok: true });
  if (request.method !== 'POST') return json(request, { error: 'Method not allowed.' }, 405);
  if (request.headers.get('origin') !== expectedOrigin) {
    return json(request, { error: 'Origin not allowed.' }, 403);
  }

  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new HttpError(400, 'Invalid JSON request.');
    }
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      throw new HttpError(400, 'Invalid request.');
    }

    await enforceRateLimit(request);
    await cleanupExpiredRecords();
    const actionBody = body as Record<string, unknown>;
    if (actionBody.action === 'options') return json(request, await createOptions());
    if (actionBody.action === 'verify') return json(request, await verifyPasskey(actionBody));
    throw new HttpError(400, 'Unsupported passkey login action.');
  } catch (error) {
    if (error instanceof HttpError) return json(request, { error: error.message }, error.status);
    console.error('Passkey login failed:', error);
    return json(request, { error: 'Passkey sign-in failed. Use your password or try again.' }, 500);
  }
});