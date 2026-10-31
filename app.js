// Shared by every page: one Supabase client plus small helpers.
// Needs the supabase-js script and config.js to be loaded first.

// Each browser tab keeps its own login (sessionStorage), so different accounts
// can be open in different tabs. A refresh keeps you signed in; closing the tab
// signs you out.
function tabStorage() {
    try {
        window.sessionStorage.setItem('__hilax', '1');
        window.sessionStorage.removeItem('__hilax');
        return window.sessionStorage;
    } catch (err) {
        return undefined; // storage blocked: the library falls back to its default
    }
}

const sb = window.supabase.createClient(
    window.HILAX_CONFIG.supabaseUrl,
    window.HILAX_CONFIG.supabaseAnonKey,
    { auth: { storage: tabStorage(), persistSession: true, autoRefreshToken: true } }
);

// Remove the login the old version left in shared browser storage.
try {
    const ref = new URL(window.HILAX_CONFIG.supabaseUrl).hostname.split('.')[0];
    window.localStorage.removeItem('sb-' + ref + '-auth-token');
} catch (err) { /* nothing to clean up */ }

const ROLE_LABELS = {
    hr_admin: 'HR / Admin',
    physician: 'Physician',
    nurse: 'Nurse',
    pharmacist: 'Pharmacist',
    medtech: 'MedTech',
    radtech: 'RadTech',
    patient: 'Patient'
};

// Patients log in with their patient number; behind the scenes it maps to an
// internal address that matches what the server creates. Staff use their email.
function loginIdToEmail(input) {
    const value = String(input || '').trim();
    if (!value) return null;
    if (value.includes('@')) return value.toLowerCase();
    const match = /^p-?0*(\d{1,8})$/i.exec(value);
    if (!match) return null;
    return 'p-' + match[1].padStart(4, '0') + '@patients.hilax.local';
}

// The signed-in user's own profile (the database only returns your own row).
async function getProfile(userId) {
    const { data, error } = await sb
        .from('users')
        .select('id, role_name, full_name, login_id, staff_number, active, must_change_password')
        .eq('id', userId)
        .maybeSingle();
    return error ? null : data;
}
