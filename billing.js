// HR / Admin: add bills and mark them as paid. The database enforces who may do
// this and what a valid bill is (amount above 0, at most 10,000,000); this file
// only checks the same things first so mistakes are caught early.

(function () {
    const { el, formatDate, formatMoney } = window.HilaxRecords;
    const $ = (id) => document.getElementById(id);

    let started = false;
    let bills = [];
    let patients = [];
    let current = null;
    let requestCounter = 0;

    function setMessage(id, text, good) {
        const node = $(id);
        node.textContent = text;
        node.className = good ? 'form-msg form-ok' : 'form-msg';
    }

    function sexLabel(value) {
        return value ? value.charAt(0).toUpperCase() + value.slice(1) : '';
    }

    async function loadPatients() {
        const { data, error } = await sb
            .from('patients')
            .select('patient_id, patient_number, full_name, age, sex')
            .order('patient_number', { ascending: true })
            .limit(500);
        if (error) { setMessage('bl-pt-msg', 'Could not load patients', false); return; }
        setMessage('bl-pt-msg', '', false);
        patients = data || [];
        renderPatients();
    }

    function renderPatients() {
        const term = $('bl-patient-search').value.trim().toLowerCase();
        const list = $('bl-patients');
        list.replaceChildren();
        const shown = patients.filter((p) =>
            !term || p.full_name.toLowerCase().includes(term) || p.patient_number.toLowerCase().includes(term));
        if (!shown.length) {
            list.appendChild(el('p', 'acc-empty', 'No patients'));
            return;
        }
        shown.forEach((p) => {
            const row = el('button', 'acc-card acc-btn');
            row.type = 'button';
            const info = el('div', 'acc-info');
            info.appendChild(el('strong', '', p.full_name));
            info.appendChild(el('span', 'acc-sub', p.patient_number + ' · ' + p.age + ' · ' + sexLabel(p.sex)));
            row.appendChild(info);
            row.addEventListener('click', () => openPatient(p));
            list.appendChild(row);
        });
    }

    function openPatient(patient) {
        current = patient;
        bills = [];
        $('bl-list-view').hidden = true;
        $('bl-detail-view').hidden = false;
        $('bl-pt-name').textContent = patient.full_name;
        $('bl-pt-sub').textContent = patient.patient_number + ' · ' + patient.age + ' · ' + sexLabel(patient.sex);
        $('billForm').reset();
        $('bl-search').value = '';
        $('bl-filter').value = '';
        setMessage('bl-msg', '', false);
        setMessage('bl-list-msg', '', false);
        $('bl-list').replaceChildren();
        window.scrollTo(0, 0);
        loadBills();
    }

    function closePatient() {
        current = null;
        requestCounter++;
        $('bl-detail-view').hidden = true;
        $('bl-list-view').hidden = false;
    }

    async function loadBills() {
        if (!current) return;
        const ticket = ++requestCounter;
        const patientId = current.patient_id;
        const { data, error } = await sb
            .from('billing')
            .select('billing_id, amount, description, created_at, paid_at')
            .eq('patient_id', patientId)
            .order('created_at', { ascending: false })
            .limit(200);
        if (ticket !== requestCounter) return; // patient changed meanwhile
        if (error) { setMessage('bl-list-msg', 'Could not load bills', false); return; }
        bills = data || [];
        renderBills();
    }

    function renderBills() {
        const filter = $('bl-filter').value;
        const term = $('bl-search').value.trim().toLowerCase();
        const list = $('bl-list');
        list.replaceChildren();
        const shown = bills.filter((b) =>
            (!filter || (filter === 'paid' ? !!b.paid_at : !b.paid_at)) &&
            (!term || b.description.toLowerCase().includes(term)));
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
        if (!current) return;
        const patientId = current.patient_id;
        const amount = readAmount($('bl-amount').value.trim().replace(/,/g, ''));
        const description = $('bl-desc').value.replace(/\s+/g, ' ').trim();
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
        if (billing) {
            closePatient();
            loadPatients(); // fresh each time, so accounts just created are included
        }
    }

    window.initBilling = function () {
        if (started) return;
        started = true;
        document.querySelectorAll('#adm-tabs button').forEach((b) => {
            b.addEventListener('click', () => showSection(b.dataset.section));
        });
        $('billForm').addEventListener('submit', submitBill);
        $('bl-filter').addEventListener('change', renderBills);
        $('bl-search').addEventListener('input', renderBills);
        $('bl-patient-search').addEventListener('input', renderPatients);
        $('bl-back').addEventListener('click', closePatient);
    };
})();
