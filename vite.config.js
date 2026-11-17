import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_SUPABASE_');
  const key = env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
  const url = env.VITE_SUPABASE_URL?.trim();

  if (key && !key.startsWith('sb_publishable_')) {
    throw new Error('Use a Supabase publishable key for VITE_SUPABASE_PUBLISHABLE_KEY.');
  }

  if (url) {
    const valid = URL.canParse(url) && ['https:', 'http:'].includes(new URL(url).protocol);
    if (!valid) throw new Error('Use an HTTP(S) Supabase project URL for VITE_SUPABASE_URL.');
  }

  return {};
});
