// ===== LOGIN =====
document.getElementById('loginForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    const msg = document.getElementById('login-msg');
    const button = this.querySelector('button[type="submit"]');
    const password = document.getElementById('login-password').value;
    const email = loginIdToEmail(document.getElementById('login-id').value);

    msg.textContent = '';
    if (!email || !password) {
        msg.textContent = 'Wrong login details';
        return;
    }

    button.disabled = true;
    try {
        const { data, error } = await sb.auth.signInWithPassword({ email, password });
        if (error) {
            msg.textContent = /banned/i.test(error.message) ? 'Account disabled' : 'Wrong login details';
            return;
        }

        const profile = await getProfile(data.user.id);
        if (!profile || !profile.active) {
            await sb.auth.signOut();
            msg.textContent = 'Account not available';
            return;
        }

        window.location.href = 'dashboard.html';
    } catch (err) {
        msg.textContent = 'Could not connect. Try again.';
    } finally {
        button.disabled = false;
    }
});
