import { createClient } from 'npm:@supabase/supabase-js@2.49.1';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from 'npm:@simplewebauthn/server@13.2.2';

const supabaseUrl = Deno.env.get('SUPABASE_URL');
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const rpId = Deno.env.get('WEBAUTHN_RP_ID');
const expectedOrigin = Deno.env.get('WEBAUTHN_ORIGIN');
const rpName = Deno.env.get('WEBAUTHN_RP_NAME') || 'CampusTools';

if (!supabaseUrl || !serviceRoleKey || !rpId || !expectedOrigin) {
  throw new Error('Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, WEBAUTHN_RP_ID and WEBAUTHN_ORIGIN for the passkeys function.');
}

const originUrl = new URL(expectedOrigin);
if (originUrl.origin !== expectedOrigin) {
  throw new Error('WEBAUTHN_ORIGIN must be an origin only, without a path or trailing slash.');
}
if (
  originUrl.protocol !== 'https:' &&
  !(originUrl.protocol === 'http:' && originUrl.hostname === 'localhost')
) {
  throw new Error('WEBAUTHN_ORIGIN must use HTTPS, except for localhost development.');
}
if (originUrl.hostname !== rpId && !originUrl.hostname.endsWith(`.${rpId}`)) {
  throw new Error('WEBAUTHN_RP_ID must match the configured origin host or one of its parent domains.');
}

const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const encoder = new TextEncoder();
const challengeLifetimeMs = 5 * 60 * 1000;
const passkeySessionLifetimeMs = 8 * 60 * 60 * 1000;

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function json(request: Request, body: unknown, status = 200) {
  const origin = request.headers.get('origin');
  const headers = new Headers({
    'content-type': 'application/json',
    'vary': 'Origin',
  });
  if (origin === expectedOrigin) {
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

function getTokenClaims(token: string) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new HttpError(401, 'Please sign in again.');
  try {
    const payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(parts[1])));
    if (typeof payload !== 'object' || payload === null) throw new Error('Invalid claims');
    return payload;
  } catch {
    throw new HttpError(401, 'Please sign in again.');
  }
}

async function getContext(request: Request) {
  const authorization = request.headers.get('authorization') || '';
  const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) throw new HttpError(401, 'Sign in before using passkeys.');

  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, 'Your sign-in has expired. Please sign in again.');

  const claims = getTokenClaims(token);
  if (
    claims.sub !== data.user.id ||
    claims.role !== 'authenticated' ||
    typeof claims.session_id !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(claims.session_id)
  ) {
    throw new HttpError(401, 'Invalid sign-in session. Please sign in again.');
  }
  return { user: data.user, sessionId: claims.session_id, aal: claims.aal };
}

async function requireSecondFactor(context: Awaited<ReturnType<typeof getContext>>) {
  if (context.aal === 'aal2') return;
  const { data, error } = await admin
    .from('passkey_verified_sessions')
    .select('session_id')
    .eq('session_id', context.sessionId)
    .eq('user_id', context.user.id)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new HttpError(403, 'Verify your authenticator code or passkey before managing passkeys.');
}

async function saveChallenge(
  userId: string,
  sessionId: string,
  challengeType: 'registration' | 'authentication',
  challenge: string,
) {
  const expiresAt = new Date(Date.now() + challengeLifetimeMs).toISOString();
  const { data, error } = await admin
    .from('passkey_challenges')
    .insert({
      user_id: userId,
      session_id: sessionId,
      challenge_type: challengeType,
      challenge,
      expires_at: expiresAt,
    })
    .select('id')
    .single();
  if (error) throw error;
  return data.id;
}

async function consumeChallenge(
  challengeId: unknown,
  userId: string,
  sessionId: string,
  challengeType: 'registration' | 'authentication',
) {
  if (typeof challengeId !== 'string') throw new HttpError(400, 'Invalid or expired passkey challenge. Try again.');
  const { data, error } = await admin
    .from('passkey_challenges')
    .update({ consumed_at: new Date().toISOString() })
    .eq('id', challengeId)
    .eq('user_id', userId)
    .eq('session_id', sessionId)
    .eq('challenge_type', challengeType)
    .is('consumed_at', null)
    .gt('expires_at', new Date().toISOString())
    .select('challenge')
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new HttpError(400, 'Invalid or expired passkey challenge. Start again.');
  return data.challenge;
}

async function cleanupExpiredRecords() {
  const now = new Date().toISOString();
  const challengeCleanup = await admin.from('passkey_challenges').delete().lt('expires_at', now);
  if (challengeCleanup.error) throw challengeCleanup.error;
  const sessionCleanup = await admin.from('passkey_verified_sessions').delete().lt('expires_at', now);
  if (sessionCleanup.error) throw sessionCleanup.error;
}

async function handleAction(context: Awaited<ReturnType<typeof getContext>>, body: Record<string, unknown>) {
  const action = body.action;
  if (typeof action !== 'string') throw new HttpError(400, 'A passkey action is required.');

  if (action === 'status') {
    if (context.aal === 'aal2') return { verified: true };
    const { data, error } = await admin
      .from('passkey_verified_sessions')
      .select('session_id')
      .eq('session_id', context.sessionId)
      .eq('user_id', context.user.id)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle();
    if (error) throw error;
    return { verified: Boolean(data) };
  }

  if (action === 'list') {
    const { data, error } = await admin
      .from('passkey_credentials')
      .select('credential_id, friendly_name, created_at, device_type, backed_up')
      .eq('user_id', context.user.id)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return {
      credentials: (data || []).map(credential => ({
        id: credential.credential_id,
        name: credential.friendly_name,
        createdAt: credential.created_at,
        deviceType: credential.device_type,
        backedUp: credential.backed_up,
      })),
    };
  }

  if (action === 'registration-options') {
    await requireSecondFactor(context);
    const { data: existing, error } = await admin
      .from('passkey_credentials')
      .select('credential_id, transports')
      .eq('user_id', context.user.id);
    if (error) throw error;

    const metadataName = context.user.user_metadata?.display_name;
    const userDisplayName = typeof metadataName === 'string'
      ? metadataName
      : context.user.email || 'CampusTools user';
    const options = await generateRegistrationOptions({
      rpName,
      rpID: rpId,
      userID: encoder.encode(context.user.id),
      userName: context.user.email || context.user.id,
      userDisplayName,
      attestationType: 'none',
      excludeCredentials: (existing || []).map(credential => ({
        id: credential.credential_id,
        transports: credential.transports,
      })),
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'required',
      },
    });
    const challengeId = await saveChallenge(context.user.id, context.sessionId, 'registration', options.challenge);
    return { challengeId, options };
  }

  if (action === 'registration-verify') {
    await requireSecondFactor(context);
    const expectedChallenge = await consumeChallenge(
      body.challengeId,
      context.user.id,
      context.sessionId,
      'registration',
    );
    if (!body.response || typeof body.response !== 'object') {
      throw new HttpError(400, 'Invalid passkey registration response.');
    }
    const verification = await verifyRegistrationResponse({
      response: body.response as Parameters<typeof verifyRegistrationResponse>[0]['response'],
      expectedChallenge,
      expectedOrigin,
      expectedRPID: rpId,
      requireUserVerification: true,
    });
    if (!verification.verified || !verification.registrationInfo) {
      throw new HttpError(400, 'Passkey registration could not be verified.');
    }

    const registration = verification.registrationInfo;
    const friendlyName = typeof body.name === 'string'
      ? body.name.trim().slice(0, 60) || 'My device'
      : 'My device';
    const { error } = await admin.from('passkey_credentials').insert({
      credential_id: registration.credential.id,
      user_id: context.user.id,
      public_key: bytesToBase64Url(registration.credential.publicKey),
      sign_count: registration.credential.counter,
      transports: registration.credential.transports || [],
      device_type: registration.credentialDeviceType,
      backed_up: Boolean(registration.credentialBackedUp),
      friendly_name: friendlyName,
    });
    if (error) {
      if (error.code === '23505') throw new HttpError(409, 'This passkey is already registered.');
      throw error;
    }
    return { registered: true };
  }

  if (action === 'authentication-options') {
    const { data: credentials, error } = await admin
      .from('passkey_credentials')
      .select('credential_id, transports')
      .eq('user_id', context.user.id);
    if (error) throw error;
    if (!credentials?.length) throw new HttpError(404, 'No passkeys are registered for this account.');

    const options = await generateAuthenticationOptions({
      rpID: rpId,
      userVerification: 'required',
      allowCredentials: credentials.map(credential => ({
        id: credential.credential_id,
        transports: credential.transports,
      })),
    });
    const challengeId = await saveChallenge(context.user.id, context.sessionId, 'authentication', options.challenge);
    return { challengeId, options };
  }

  if (action === 'authentication-verify') {
    const expectedChallenge = await consumeChallenge(
      body.challengeId,
      context.user.id,
      context.sessionId,
      'authentication',
    );
    const response = body.response as { id?: unknown } | undefined;
    if (!response || typeof response.id !== 'string') {
      throw new HttpError(400, 'Invalid passkey authentication response.');
    }
    const { data: credential, error } = await admin
      .from('passkey_credentials')
      .select('credential_id, public_key, sign_count, transports')
      .eq('credential_id', response.id)
      .eq('user_id', context.user.id)
      .maybeSingle();
    if (error) throw error;
    if (!credential) throw new HttpError(403, 'This passkey is not registered to your account.');

    const verification = await verifyAuthenticationResponse({
      response: body.response as Parameters<typeof verifyAuthenticationResponse>[0]['response'],
      expectedChallenge,
      expectedOrigin,
      expectedRPID: rpId,
      credential: {
        id: credential.credential_id,
        publicKey: base64UrlToBytes(credential.public_key),
        counter: Number(credential.sign_count),
        transports: credential.transports,
      },
      requireUserVerification: true,
    });
    if (!verification.verified) throw new HttpError(401, 'Passkey verification failed.');

    const { data: updatedCredential, error: updateError } = await admin
      .from('passkey_credentials')
      .update({
        sign_count: verification.authenticationInfo.newCounter,
        last_used_at: new Date().toISOString(),
      })
      .eq('credential_id', credential.credential_id)
      .eq('user_id', context.user.id)
      .eq('sign_count', credential.sign_count)
      .select('credential_id')
      .maybeSingle();
    if (updateError) throw updateError;
    if (!updatedCredential) {
      throw new HttpError(409, 'This passkey was used at the same time in another request. Try again.');
    }

    const { error: sessionError } = await admin.from('passkey_verified_sessions').upsert({
      session_id: context.sessionId,
      user_id: context.user.id,
      expires_at: new Date(Date.now() + passkeySessionLifetimeMs).toISOString(),
      verified_at: new Date().toISOString(),
    });
    if (sessionError) throw sessionError;
    return { verified: true };
  }

  if (action === 'remove') {
    await requireSecondFactor(context);
    if (typeof body.credentialId !== 'string') throw new HttpError(400, 'Choose a passkey to remove.');
    const { data, error } = await admin
      .from('passkey_credentials')
      .delete()
      .eq('credential_id', body.credentialId)
      .eq('user_id', context.user.id)
      .select('credential_id')
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new HttpError(404, 'Passkey not found.');
    return { removed: true };
  }

  throw new HttpError(400, 'Unsupported passkey action.');
}

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return json(request, { ok: true });
  if (request.method !== 'POST') return json(request, { error: 'Method not allowed.' }, 405);
  if (request.headers.get('origin') !== expectedOrigin) {
    return json(request, { error: 'This origin is not allowed.' }, 403);
  }

  try {
    const context = await getContext(request);
    await cleanupExpiredRecords();
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new HttpError(400, 'Invalid JSON request.');
    }
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      throw new HttpError(400, 'Invalid request.');
    }
    const result = await handleAction(context, body as Record<string, unknown>);
    return json(request, result);
  } catch (error) {
    if (error instanceof HttpError) return json(request, { error: error.message }, error.status);
    console.error('Passkey function failed:', error);
    return json(request, { error: 'Passkey request failed. Please try again.' }, 500);
  }
});
