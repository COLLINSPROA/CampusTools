import { supabase } from './supabase.js';

export async function getCurrentUser() {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  return data.user;
}

export async function getProfile(userId) {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, display_name, role')
    .eq('id', userId)
    .single();
  if (error) throw error;
  return data;
}

export async function requireAAL2() {
  const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (error) throw error;
  return data.currentLevel === 'aal2';
}

export async function listVerifiedTotpFactors() {
  const { data, error } = await supabase.auth.mfa.listFactors();
  if (error) throw error;
  return (data.totp || []).filter(factor => factor.status === 'verified');
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}
