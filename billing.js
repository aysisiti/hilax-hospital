// HR / Admin: add bills and mark them as paid. The database enforces who may do
// this and what a valid bill is (amount above 0, at most 10,000,000); this file
// only checks the same things first so mistakes are caught early.

(function () {
    const { el, formatDate, formatMoney } = window.HilaxRecords;
    const $ = (id) => document.getElementById(id);

    let started = false;
    let bills = [];
    let patientsLoaded = false;

    function setMessage(id, text, good) {
        const node = $(id);
        node.textContent = text;
        node.className = good ? 'form-msg form-ok' : 'form-msg';
    }

    async function loadPatients() {
        const { data, error } = await sb
            .from('patients')
            .select('patient_id, patient_number, full_name')
            .order('patient_number', { ascending: true })
            .limit(500);
        if (error) { setMessage('bl-msg', 'Could not load patients', false); return; }
        const select = $('bl-patient');
        (data || []).forEach((p) => {
            const option = el('option', '', p.patient_number + ' · ' + p.full_name);
            option.value = p.patient_id;
            select.appendChild(option);
        });
        patientsLoaded = true;
    }

    async function loadBills() {
        const { data, error } = await sb
            .from('billing')
            .select('billing_id, amount, description, created_at, paid_at, patients(full_name, patient_number)')
            .order('created_at', { ascending: false })
            .limit(100);
        if (error) { setMessage('bl-list-msg', 'Could not load bills', false); return; }
        setMessage('bl-list-msg', '', false);
        bills = data || [];
        renderBills();
    }

    function renderBills() {
        const filter = $('bl-filter').value;
        const list = $('bl-list');
        list.replaceChildren();
        const shown = bills.filter((b) =>
            !filter || (filter === 'paid' ? !!b.paid_at : !b.paid_at));
        if (!shown.length) {
            list.appendChild(el('p', 'acc-empty', 'No bills'));
            return;
        }
        shown.forEach((b) => {
            const card = el('div', 'rec-card');
            const head = el('div', 'rec-head');
            head.appendChild(el('strong', '', formatMoney(b.amount)));
            head.appendChild(el('span', b.paid_at ? 'rec-tag' : 'rec-tag rec-tag-unpaid', b.paid_at ? 'Paid' : 'Unpaid'));
            card.appendChild(head);
            const who = b.patients ? b.patients.patient_number + ' · ' + b.patients.full_name : '';
            card.appendChild(el('span', 'rec-line', who));
            card.appendChild(el('span', 'rec-line', b.description));
            card.appendChild(el('span', 'rec-date',
                b.paid_at ? 'Paid ' + formatDate(b.paid_at) : formatDate(b.created_at)));
            if (!b.paid_at) card.appendChild(payControl(b));
            list.appendChild(card);
        });
    }

    function payControl(bill) {
        const wrap = el('div', 'rec-action');
        const start = el('button', 'btn-small', 'Mark paid');
        start.type = 'button';
        wrap.appendChild(start);
        start.addEventListener('click', () => {
            wrap.replaceChildren();
            const confirm = el('button', 'btn-small btn-confirm', 'Confirm paid');
            confirm.type = 'button';
            const cancel = el('button', 'btn-small', 'Cancel');
            cancel.type = 'button';
            cancel.addEventListener('click', () => wrap.replaceChildren(start));
            confirm.addEventListener('click', () => markPaid(bill, confirm, cancel));
            const buttons = el('div', 'rec-action-buttons');
            buttons.append(confirm, cancel);
            wrap.appendChild(buttons);
        });
        return wrap;
    }

    async function markPaid(bill, confirm, cancel) {
        confirm.disabled = true;
        cancel.disabled = true;
        setMessage('bl-list-msg', '', false);
        const { data, error } = await sb
            .from('billing')
            .update({ paid_at: new Date().toISOString() })
            .eq('billing_id', bill.billing_id)
            .select('billing_id');
        const already = error && error.code === '23514';
        if ((error && !already) || (!error && !(data && data.length))) {
            confirm.disabled = false;
            cancel.disabled = false;
            setMessage('bl-list-msg', 'Could not save', false);
            return;
        }
        await loadBills(); // shows the true state, with the time the database recorded
        setMessage('bl-list-msg', already ? 'Already paid' : 'Marked as paid', !already);
    }

    function readAmount(raw) {
        if (!/^\d{1,8}(\.\d{1,2})?$/.test(raw)) return NaN;
        const value = Number(raw);
        return value > 0 && value <= 10000000 ? value : NaN;
    }

    async function submitBill(e) {
        e.preventDefault();
        const patientId = $('bl-patient').value;
        const amount = readAmount($('bl-amount').value.trim().replace(/,/g, ''));
        const description = $('bl-desc').value.replace(/\s+/g, ' ').trim();
        if (!patientId) { setMessage('bl-msg', 'Choose a patient', false); return; }
        if (isNaN(amount)) { setMessage('bl-msg', 'Amount must be above 0 and at most 10,000,000', false); return; }
        if (!description) { setMessage('bl-msg', 'Enter a description', false); return; }
        if (description.length > 500 || /[\u0000-\u001f\u007f]/.test(description)) {
            setMessage('bl-msg', 'Check the description', false);
            return;
        }

        const button = $('billForm').querySelector('button[type="submit"]');
        button.disabled = true;
        setMessage('bl-msg', '', false);
        const { error } = await sb.from('billing').insert({
            patient_id: patientId,
            amount: amount,
            description: description
        });
        button.disabled = false;
        if (error) {
            setMessage('bl-msg', error.code === '23514' ? 'Check the values' : 'Could not save', false);
            return;
        }
        $('bl-amount').value = '';
        $('bl-desc').value = '';
        setMessage('bl-msg', 'Saved', true);
        loadBills();
    }

    function showSection(name) {
        const billing = name === 'billing';
        $('adm-accounts').hidden = billing;
        $('adm-billing').hidden = !billing;
        document.querySelectorAll('#adm-tabs button').forEach((b) => {
            b.classList.toggle('active', b.dataset.section === name);
        });
        if (billing && !patientsLoaded) loadPatients();
        if (billing) loadBills();
    }

    window.initBilling = function () {
        if (started) return;
        started = true;
        document.querySelectorAll('#adm-tabs button').forEach((b) => {
            b.addEventListener('click', () => showSection(b.dataset.section));
        });
        $('billForm').addEventListener('submit', submitBill);
        $('bl-filter').addEventListener('change', renderBills);
    };
})();
