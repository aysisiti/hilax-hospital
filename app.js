// Shared by every page: one Supabase client plus small helpers.
// Needs the supabase-js script and config.js to be loaded first.
const sb = window.supabase.createClient(
    window.HILAX_CONFIG.supabaseUrl,
    window.HILAX_CONFIG.supabaseAnonKey
);

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
