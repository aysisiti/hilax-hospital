// HR / Admin panel: list accounts, create patient or staff accounts, disable/enable,
// reset passwords. Every change goes through the admin-users server function;
// the browser only reads the list (the database limits that to HR/Admin).

(function () {
    let started = false;
    let myId = null;
    let accounts = [];

    const $ = (id) => document.getElementById(id);

    // ----- talk to the server function -----
    async function callAdmin(payload) {
        const { data: sessionData } = await sb.auth.getSession();
        const token = sessionData && sessionData.session && sessionData.session.access_token;
        if (!token) { goHome(); return { ok: false, data: {} }; }
        try {
            const response = await fetch(window.HILAX_CONFIG.supabaseUrl + '/functions/v1/admin-users', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + token,
                    'apikey': window.HILAX_CONFIG.supabaseAnonKey
                },
                body: JSON.stringify(payload)
            });
            const data = await response.json().catch(() => ({}));
            if (response.status === 401) { goHome(); return { ok: false, data }; }
            return { ok: response.ok, data };
        } catch (err) {
            return { ok: false, data: { error: 'Could not connect. Try again.' } };
        }
    }

    // ----- list -----
    async function loadAccounts() {
        const { data, error } = await sb
            .from('users')
            .select('id, full_name, role_name, login_id, staff_number, active, created_at')
            .order('created_at', { ascending: false });
        if (error) {
            $('acc-msg').textContent = 'Could not load accounts';
            return;
        }
        $('acc-msg').textContent = '';
        accounts = data || [];
        renderAccounts();
    }

    function el(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    function renderAccounts() {
        const term = $('acc-search').value.trim().toLowerCase();
        const role = $('acc-filter').value;
        const list = $('acc-list');
        list.replaceChildren();

        const shown = accounts.filter((a) => {
            if (role && a.role_name !== role) return false;
            if (!term) return true;
            const number = a.staff_number || a.login_id || '';
            return a.full_name.toLowerCase().includes(term) || number.toLowerCase().includes(term);
        });

        if (!shown.length) {
            list.appendChild(el('p', 'acc-empty', 'No accounts'));
            return;
        }

        shown.forEach((a) => {
            const card = el('div', 'acc-card' + (a.active ? '' : ' acc-off'));

            const info = el('div', 'acc-info');
            info.appendChild(el('strong', '', a.full_name));
            info.appendChild(el('span', 'acc-sub',
                (ROLE_LABELS[a.role_name] || a.role_name) + ' · ' + (a.staff_number || a.login_id)));
            if (!a.active) info.appendChild(el('span', 'acc-badge', 'Disabled'));
            card.appendChild(info);

            if (a.id !== myId) {
                const actions = el('div', 'acc-actions');
                const toggle = el('button', 'btn-small', a.active ? 'Disable' : 'Enable');
                toggle.type = 'button';
                toggle.addEventListener('click', () => toggleActive(a, toggle));
                const reset = el('button', 'btn-small', 'Reset password');
                reset.type = 'button';
                reset.addEventListener('click', () => resetPassword(a, reset));
                actions.append(toggle, reset);
                card.appendChild(actions);
            }
            list.appendChild(card);
        });
    }

    async function toggleActive(account, button) {
        const next = !account.active;
        if (!window.confirm((next ? 'Enable ' : 'Disable ') + account.full_name + '?')) return;
        button.disabled = true;
        const { ok, data } = await callAdmin({ action: 'set_active', user_id: account.id, active: next });
        button.disabled = false;
        if (!ok) { $('acc-msg').textContent = data.error || 'Could not update account'; return; }
        await loadAccounts();
    }

    async function resetPassword(account, button) {
        if (!window.confirm('Reset password for ' + account.full_name + '?')) return;
        button.disabled = true;
        const { ok, data } = await callAdmin({ action: 'reset_password', user_id: account.id });
        button.disabled = false;
        if (!ok) { $('acc-msg').textContent = data.error || 'Could not reset password'; return; }
        showCredentials('New password', account.full_name, account.staff_number || account.login_id, data.temp_password);
    }

    // ----- one-time credentials screen -----
    let credentialText = '';

    function showCredentials(title, name, login, password) {
        $('cred-title').textContent = title;
        $('cred-name').textContent = name;
        $('cred-login').textContent = login;
        $('cred-password').textContent = password;
        credentialText = 'Login: ' + login + '\nPassword: ' + password;
        $('cred-copy').textContent = 'Copy';
        $('cred-overlay').style.display = 'flex';
    }

    function closeCredentials() {
        $('cred-overlay').style.display = 'none';
        $('cred-password').textContent = '';
        credentialText = '';
    }

    async function copyCredentials() {
        try {
            await navigator.clipboard.writeText(credentialText);
            $('cred-copy').textContent = 'Copied';
        } catch (err) {
            // Clipboard blocked: select the password so it can be copied by hand.
            const range = document.createRange();
            range.selectNodeContents($('cred-password'));
            const selection = window.getSelection();
            selection.removeAllRanges();
            selection.addRange(range);
            $('cred-copy').textContent = 'Press copy';
        }
    }

    // ----- create form -----
    function syncCreateFields() {
        const isPatient = $('c-role').value === 'patient';
        $('c-patient-fields').hidden = !isPatient;
        $('c-email').placeholder = isPatient ? 'Email (optional)' : 'Email';
        $('c-email').required = !isPatient;
        $('c-age').required = isPatient;
        $('c-sex').required = isPatient;
        $('c-address').required = isPatient;
    }

    function openCreate() {
        $('createForm').reset();
        $('create-msg').textContent = '';
        syncCreateFields();
        $('create-overlay').style.display = 'flex';
    }

    function closeCreate() {
        $('create-overlay').style.display = 'none';
    }

    async function submitCreate(e) {
        e.preventDefault();
        const msg = $('create-msg');
        const button = $('createForm').querySelector('button[type="submit"]');
        const role = $('c-role').value;
        const payload = {
            action: 'create_user',
            role: role,
            full_name: $('c-name').value,
            email: $('c-email').value.trim()
        };
        if (role === 'patient') {
            payload.age = Number($('c-age').value);
            payload.sex = $('c-sex').value;
            payload.address = $('c-address').value;
        }

        msg.textContent = '';
        button.disabled = true;
        const { ok, data } = await callAdmin(payload);
        button.disabled = false;
        if (!ok) { msg.textContent = data.error || 'Could not create account'; return; }

        closeCreate();
        showCredentials('Account created', data.user.full_name, data.user.login_id, data.temp_password);
        await loadAccounts();
    }

    // ----- start -----
    window.initAdmin = function (profile) {
        if (started) return;
        started = true;
        myId = profile.id;

        $('admin-panel').hidden = false;
        $('acc-search').addEventListener('input', renderAccounts);
        $('acc-filter').addEventListener('change', renderAccounts);
        $('new-account-btn').addEventListener('click', openCreate);
        $('c-role').addEventListener('change', syncCreateFields);
        $('createForm').addEventListener('submit', submitCreate);
        $('create-close').addEventListener('click', closeCreate);
        $('cred-close').addEventListener('click', closeCredentials);
        $('cred-copy').addEventListener('click', copyCredentials);
        loadAccounts();
    };
})();
