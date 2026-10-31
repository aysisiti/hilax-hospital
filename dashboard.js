// Dashboard shell: checks who is signed in (from the server), forces a password
// change for new accounts, then shows the page for that user's role.

function goHome() {
    window.location.replace('index.html');
}

async function logout() {
    await sb.auth.signOut();
    goHome();
}

function showDashboard(profile) {
    document.getElementById('pw-overlay').style.display = 'none';
    document.getElementById('dash-name').textContent = profile.full_name;
    const number = profile.staff_number || profile.login_id;
    document.getElementById('dash-role').textContent =
        (ROLE_LABELS[profile.role_name] || profile.role_name) + ' · ' + number;
    document.getElementById('dash').hidden = false;
    if (profile.role_name === 'hr_admin') initAdmin(profile);
}

function askNewPassword() {
    document.getElementById('dash').hidden = true;
    document.getElementById('pw-overlay').style.display = 'flex';
}

// Tabs in the same browser share one login. If another tab logs out or signs in
// as someone else, this page must not keep acting as the old user.
let currentUserId = null;
sb.auth.onAuthStateChange(function (event, session) {
    if (!currentUserId) return;
    if (!session) {
        if (event === 'SIGNED_OUT') goHome();
        return;
    }
    if (session.user.id !== currentUserId) window.location.reload();
});

async function loadDashboard() {
    // getUser asks the server, so a removed or disabled login is caught here.
    const { data, error } = await sb.auth.getUser();
    if (error || !data || !data.user) return goHome();
    currentUserId = data.user.id;

    const profile = await getProfile(data.user.id);
    if (!profile || !profile.active || !ROLE_LABELS[profile.role_name]) {
        await sb.auth.signOut();
        return goHome();
    }

    if (profile.must_change_password) {
        askNewPassword();
    } else {
        showDashboard(profile);
    }
}

document.getElementById('logout-btn').addEventListener('click', function (e) {
    e.preventDefault();
    logout();
});

document.getElementById('pwForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    const msg = document.getElementById('pw-msg');
    const button = this.querySelector('button[type="submit"]');
    const current = document.getElementById('pw-current').value;
    const next = document.getElementById('pw-new').value;
    const confirm = document.getElementById('pw-confirm').value;

    msg.textContent = '';
    if (next.length < 8) { msg.textContent = 'Use at least 8 characters'; return; }
    if (next !== confirm) { msg.textContent = 'Passwords do not match'; return; }

    button.disabled = true;
    try {
        const { data: sessionData } = await sb.auth.getSession();
        const token = sessionData && sessionData.session && sessionData.session.access_token;
        if (!token) return goHome();

        const response = await fetch(window.HILAX_CONFIG.supabaseUrl + '/functions/v1/change-password', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + token,
                'apikey': window.HILAX_CONFIG.supabaseAnonKey
            },
            body: JSON.stringify({ current_password: current, new_password: next })
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
            msg.textContent = result.error || 'Could not save. Try again.';
            return;
        }

        this.reset();
        await loadDashboard();
    } catch (err) {
        msg.textContent = 'Could not connect. Try again.';
    } finally {
        button.disabled = false;
    }
});

loadDashboard();
