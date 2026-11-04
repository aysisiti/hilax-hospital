// Staff panel: find a patient, view the records this role may read, and add the
// records this role is allowed to write. What each role can actually see or
// change is decided by the database (row-level security); this file only
// decides what to show. Roles are switched on one at a time in ROLE_CONFIG.

(function () {
    const { el, TABS, load } = window.HilaxRecords;

    const ROLE_CONFIG = {
        nurse: { tabs: ['vitals', 'prescriptions', 'labs', 'imaging'], addVitals: true },
        physician: { tabs: ['prescriptions', 'vitals', 'labs', 'imaging'], addPrescription: true },
        pharmacist: { tabs: ['prescriptions', 'vitals'], canDispense: true },
        medtech: { tabs: ['labs', 'vitals'], addLab: true }
    };

    let started = false;
    let myId = null;
    let config = null;
    let patients = [];
    let current = null;
    let activeTab = null;
    let requestCounter = 0;

    const $ = (id) => document.getElementById(id);

    // ----- patient list -----
    async function loadPatients() {
        const { data, error } = await sb
            .from('patients')
            .select('patient_id, patient_number, full_name, age, sex')
            .order('patient_number', { ascending: true })
            .limit(500);
        if (error) {
            $('st-msg').textContent = 'Could not load patients';
            return;
        }
        $('st-msg').textContent = '';
        patients = data || [];
        renderPatients();
    }

    function sexLabel(value) {
        return value ? value.charAt(0).toUpperCase() + value.slice(1) : '';
    }

    function renderPatients() {
        const term = $('st-search').value.trim().toLowerCase();
        const list = $('st-list');
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
            info.appendChild(el('span', 'acc-sub',
                p.patient_number + ' · ' + p.age + ' · ' + sexLabel(p.sex)));
            row.appendChild(info);
            row.addEventListener('click', () => openPatient(p));
            list.appendChild(row);
        });
    }

    // ----- one patient -----
    function openPatient(patient) {
        current = patient;
        $('st-list-view').hidden = true;
        $('st-detail-view').hidden = false;
        $('st-pt-name').textContent = patient.full_name;
        $('st-pt-sub').textContent =
            patient.patient_number + ' · ' + patient.age + ' · ' + sexLabel(patient.sex);
        $('vitalsForm').hidden = !config.addVitals;
        $('vitalsForm').reset();
        setVitalsMessage('', false);
        $('prescriptionForm').hidden = !config.addPrescription;
        $('prescriptionForm').reset();
        setPrescriptionMessage('', false);
        $('labForm').hidden = !config.addLab;
        $('labForm').reset();
        setLabMessage('', false);

        const tabs = $('st-tabs');
        tabs.replaceChildren();
        config.tabs.forEach((name) => {
            const button = el('button', '', TABS[name].label);
            button.type = 'button';
            button.dataset.tab = name;
            button.addEventListener('click', () => showTab(name));
            tabs.appendChild(button);
        });
        window.scrollTo(0, 0);
        showTab(config.tabs[0]);
    }

    function closePatient() {
        current = null;
        activeTab = null;
        requestCounter++;
        $('st-detail-view').hidden = true;
        $('st-list-view').hidden = false;
    }

    async function showTab(name) {
        activeTab = name;
        const ticket = ++requestCounter;
        document.querySelectorAll('#st-tabs button').forEach((b) => {
            b.classList.toggle('active', b.dataset.tab === name);
        });
        const box = $('st-records');
        $('st-rec-msg').textContent = '';
        box.replaceChildren();

        const result = await load(name, current.patient_id);
        if (ticket !== requestCounter) return; // patient or tab changed meanwhile
        if (!result) {
            $('st-rec-msg').textContent = 'Could not load records';
            return;
        }
        if (!result.rows.length) {
            box.appendChild(el('p', 'acc-empty', 'No records'));
            return;
        }
        let rows = result.rows;
        if (config.canDispense && name === 'prescriptions') {
            // Pending prescriptions first (the sort keeps newest-first within each group).
            const isDone = (r) => (result.extra[r.prescription_id] ? 1 : 0);
            rows = rows.slice().sort((a, b) => isDone(a) - isDone(b));
        }
        const ctx = { myId: myId, prescriptionAction: config.canDispense ? dispenseControl : null };
        rows.forEach((row) => box.appendChild(TABS[name].render(row, result.extra, ctx)));
    }

    // ----- pharmacist: dispense a prescription -----
    function setRecMessage(text, good) {
        const node = $('st-rec-msg');
        node.textContent = text;
        node.className = good ? 'form-msg form-ok' : 'form-msg';
    }

    function dispenseControl(row) {
        const wrap = el('div', 'rec-action');
        const start = el('button', 'btn-small', 'Dispense');
        start.type = 'button';
        wrap.appendChild(start);

        start.addEventListener('click', () => {
            wrap.replaceChildren();
            const note = el('input', 'rec-note');
            note.type = 'text';
            note.placeholder = 'Note (optional)';
            note.maxLength = 500;
            note.autocomplete = 'off';
            const confirm = el('button', 'btn-small btn-confirm', 'Confirm');
            confirm.type = 'button';
            const cancel = el('button', 'btn-small', 'Cancel');
            cancel.type = 'button';
            cancel.addEventListener('click', () => wrap.replaceChildren(start));
            confirm.addEventListener('click', () => dispense(row, note.value, confirm, cancel));
            const buttons = el('div', 'rec-action-buttons');
            buttons.append(confirm, cancel);
            wrap.append(note, buttons);
            note.focus();
        });
        return wrap;
    }

    async function dispense(row, noteRaw, confirm, cancel) {
        const note = noteRaw.replace(/\s+/g, ' ').trim();
        if (note.length > 500 || /[\u0000-\u001f\u007f]/.test(note)) {
            setRecMessage('Check the note', false);
            return;
        }
        confirm.disabled = true;
        cancel.disabled = true;
        setRecMessage('', false);

        const { error } = await sb.from('dispense_logs').insert({
            prescription_id: row.prescription_id,
            pharmacist_id: myId,
            notes: note || null
        });

        if (error && error.code !== '23505') {
            confirm.disabled = false;
            cancel.disabled = false;
            setRecMessage('Could not save', false);
            return;
        }
        // Saved, or someone else already dispensed it: refresh to show the true state.
        const alreadyDone = !!error;
        await showTab('prescriptions');
        setRecMessage(alreadyDone ? 'Already dispensed' : 'Dispensed', !alreadyDone);
    }

    // ----- nurse: record vitals -----
    function setVitalsMessage(text, good) {
        const node = $('vt-msg');
        node.textContent = text;
        node.className = good ? 'form-msg form-ok' : 'form-msg';
    }

    function wholeNumber(raw) {
        return /^\d{1,3}$/.test(raw) ? Number(raw) : NaN;
    }

    // Returns { values } or { error }. The database checks the same rules again.
    function readVitals() {
        const hr = wholeNumber($('vt-hr').value.trim());
        const sys = wholeNumber($('vt-sys').value.trim());
        const dia = wholeNumber($('vt-dia').value.trim());
        const tempRaw = $('vt-temp').value.trim();

        if (!(hr >= 20 && hr <= 300)) return { error: 'Heart rate must be 20 to 300' };
        if (!(sys >= 50 && sys <= 300 && dia >= 30 && dia <= 200 && sys > dia)) {
            return { error: 'Check the blood pressure' };
        }
        const temp = Number(tempRaw);
        if (!/^\d{2}(\.\d)?$/.test(tempRaw) || !(temp >= 30 && temp <= 45)) {
            return { error: 'Temperature must be 30 to 45, one decimal' };
        }
        return { values: { heart_rate: hr, blood_pressure: sys + '/' + dia, temperature: temp } };
    }

    async function submitVitals(e) {
        e.preventDefault();
        if (!current) return;
        const checked = readVitals();
        if (checked.error) { setVitalsMessage(checked.error, false); return; }

        const button = $('vitalsForm').querySelector('button[type="submit"]');
        button.disabled = true;
        setVitalsMessage('', false);
        const { error } = await sb.from('vitals').insert({
            patient_id: current.patient_id,
            nurse_id: myId,
            heart_rate: checked.values.heart_rate,
            blood_pressure: checked.values.blood_pressure,
            temperature: checked.values.temperature
        });
        button.disabled = false;

        if (error) {
            setVitalsMessage(error.code === '23514' ? 'Check the values' : 'Could not save', false);
            return;
        }
        $('vitalsForm').reset();
        setVitalsMessage('Saved', true);
        showTab('vitals');
    }

    // ----- physician: write a prescription -----
    function setPrescriptionMessage(text, good) {
        const node = $('rx-msg');
        node.textContent = text;
        node.className = good ? 'form-msg form-ok' : 'form-msg';
    }

    // One line of text, 1 to 120 characters, no control characters.
    function cleanText(raw) {
        const text = raw.replace(/\s+/g, ' ').trim();
        return text.length >= 1 && text.length <= 120 && !/[\u0000-\u001f\u007f]/.test(text) ? text : null;
    }

    async function submitPrescription(e) {
        e.preventDefault();
        if (!current) return;
        const medication = cleanText($('rx-med').value);
        const dosage = cleanText($('rx-dose').value);
        const frequency = cleanText($('rx-freq').value);
        if (!medication) { setPrescriptionMessage('Enter the medication', false); return; }
        if (!dosage) { setPrescriptionMessage('Enter the dosage', false); return; }
        if (!frequency) { setPrescriptionMessage('Enter the frequency', false); return; }

        const button = $('prescriptionForm').querySelector('button[type="submit"]');
        button.disabled = true;
        setPrescriptionMessage('', false);
        const { error } = await sb.from('prescriptions').insert({
            patient_id: current.patient_id,
            physician_id: myId,
            medication_name: medication,
            dosage: dosage,
            frequency: frequency
        });
        button.disabled = false;

        if (error) {
            setPrescriptionMessage(error.code === '23514' ? 'Check the values' : 'Could not save', false);
            return;
        }
        $('prescriptionForm').reset();
        setPrescriptionMessage('Saved', true);
        showTab('prescriptions');
    }

    // ----- medtech: enter a lab result -----
    function setLabMessage(text, good) {
        const node = $('lab-msg');
        node.textContent = text;
        node.className = good ? 'form-msg form-ok' : 'form-msg';
    }

    async function submitLab(e) {
        e.preventDefault();
        if (!current) return;
        const testName = cleanText($('lab-test').value);
        // Results may span several lines, so keep line breaks (but tidy spaces and blank runs).
        const results = $('lab-results').value
            .replace(/\r\n?/g, '\n')
            .replace(/[ \t]+/g, ' ')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
        if (!testName) { setLabMessage('Enter the test name', false); return; }
        if (!results) { setLabMessage('Enter the results', false); return; }
        if (results.length > 5000 || /[\u0000-\u0008\u000b-\u001f\u007f]/.test(results)) {
            setLabMessage('Check the results', false);
            return;
        }

        const button = $('labForm').querySelector('button[type="submit"]');
        button.disabled = true;
        setLabMessage('', false);
        const { error } = await sb.from('lab_results').insert({
            patient_id: current.patient_id,
            medtech_id: myId,
            test_name: testName,
            results: results
        });
        button.disabled = false;

        if (error) {
            setLabMessage(error.code === '23514' ? 'Check the values' : 'Could not save', false);
            return;
        }
        $('labForm').reset();
        setLabMessage('Saved', true);
        showTab('labs');
    }

    // ----- start -----
    window.initStaff = function (profile) {
        config = ROLE_CONFIG[profile.role_name];
        if (!config || started) return;
        started = true;
        myId = profile.id;

        $('staff-panel').hidden = false;
        $('st-search').addEventListener('input', renderPatients);
        $('st-back').addEventListener('click', closePatient);
        $('vitalsForm').addEventListener('submit', submitVitals);
        $('prescriptionForm').addEventListener('submit', submitPrescription);
        $('labForm').addEventListener('submit', submitLab);
        loadPatients();
    };
})();
