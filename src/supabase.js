import { createClient } from '@supabase/supabase-js';

const SUPA_URL = "https://autdjklobwkgwhqlbngo.supabase.co";
const SUPA_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF1dGRqa2xvYndrZ3docWxibmdvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM0MDkyNDAsImV4cCI6MjA4ODk4NTI0MH0.YZ_u4QQOTrHpeeXxM0M4-YO3Z9itIeUvMgWjqbknVQ4";

export const supabase = createClient(SUPA_URL, SUPA_KEY);

export async function getRegistros() {
  const { data, error } = await supabase.from('registros').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function insertRegistro(reg) {
  const { data, error } = await supabase.from('registros').insert([reg]).select();
  if (error) throw error;
  return data;
}

export async function updateRegistro(id, changes) {
  const { data, error } = await supabase.from('registros').update(changes).eq('id', id).select();
  if (error) throw error;
  return data;
}

export async function deleteRegistro(id) {
  const { error } = await supabase.from('registros').delete().eq('id', id);
  if (error) throw error;
}
