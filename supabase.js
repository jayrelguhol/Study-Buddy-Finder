window.SUPABASE_URL = 'https://jlxengicdryfcpbxcsch.supabase.co';
window.SUPABASE_ANON_KEY = 'sb_publishable_CqzqXNJQw9LPLnwVIE2hXA_38jMDqQQ';

if (window.supabase && window.SUPABASE_URL && window.SUPABASE_ANON_KEY) {
    window.supabaseClient = window.supabase.createClient(
        window.SUPABASE_URL,
        window.SUPABASE_ANON_KEY
    );
} else {
    console.warn('Supabase client was not initialized. Check supabase.js configuration.');
}
