// Staff panel: find a patient, view the records this role may read, and add the
// records this role is allowed to write. What each role can actually see or
// change is decided by the database (row-level security); this file only
// decides what to show. Roles are switched on one at a time in ROLE_CONFIG.

(function () {
    const { el, TABS, load } = window.HilaxRecords;

    const ROLE_CONFIG = {
        nurse: { tabs: ['vitals', 'prescriptions', 'labs', 'imaging'], addVitals: true }
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
        result.rows.forEach((row) => box.appendChild(TABS[name].render(row, result.extra, { myId: myId })));
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
        loadPatients();
    };
})();
