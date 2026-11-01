// Patient panel: the signed-in patient's own records, read-only.
// The database only returns rows that belong to this patient, so there is no
// patient id in these requests.

(function () {
    let started = false;
    const loaded = {};

    const $ = (id) => document.getElementById(id);

    function el(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined && text !== null) node.textContent = text;
        return node;
    }

    // created_at columns have no time zone and are stored in UTC.
    function formatDate(value) {
        if (!value) return '';
        const text = String(value);
        const date = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(text) ? text : text.replace(' ', 'T') + 'Z');
        if (isNaN(date.getTime())) return '';
        return date.toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' });
    }

    function formatMoney(value) {
        const amount = Number(value);
        if (!isFinite(amount)) return '';
        return new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(amount);
    }

    // Only plain web links are made clickable.
    function safeUrl(value) {
        try {
            const url = new URL(String(value));
            return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
        } catch (err) {
            return null;
        }
    }

    function card(title, lines, date, tag) {
        const box = el('div', 'rec-card');
        const head = el('div', 'rec-head');
        head.appendChild(el('strong', '', title));
        if (tag) head.appendChild(el('span', 'rec-tag', tag));
        box.appendChild(head);
        lines.forEach((line) => {
            if (line instanceof Node) box.appendChild(line);
            else if (line) box.appendChild(el('span', 'rec-line', line));
        });
        if (date) box.appendChild(el('span', 'rec-date', formatDate(date)));
        return box;
    }

    // What each tab shows and how to read it.
    const TABS = {
        vitals: {
            table: 'vitals',
            columns: 'vitals_id, heart_rate, blood_pressure, temperature, created_at',
            render: (r) => card(
                'BP ' + r.blood_pressure,
                ['Heart rate ' + r.heart_rate + ' bpm', 'Temperature ' + r.temperature + ' °C'],
                r.created_at)
        },
        prescriptions: {
            table: 'prescriptions',
            columns: 'prescription_id, medication_name, dosage, frequency, created_at',
            extra: async () => {
                const { data } = await sb.from('dispense_logs').select('prescription_id, dispensed_at');
                const map = {};
                (data || []).forEach((d) => { map[d.prescription_id] = d.dispensed_at; });
                return map;
            },
            render: (r, dispensed) => card(
                r.medication_name,
                [r.dosage + ' · ' + r.frequency,
                    dispensed[r.prescription_id] ? 'Dispensed ' + formatDate(dispensed[r.prescription_id]) : null],
                r.created_at,
                dispensed[r.prescription_id] ? 'Dispensed' : null)
        },
        labs: {
            table: 'lab_results',
            columns: 'lab_id, test_name, results, created_at',
            render: (r) => card(r.test_name, [r.results], r.created_at)
        },
        imaging: {
            table: 'imaging_results',
            columns: 'imaging_id, imaging_type, findings, image_url, created_at',
            render: (r) => {
                const lines = [r.findings];
                const href = r.image_url ? safeUrl(r.image_url) : null;
                if (href) {
                    const link = el('a', 'rec-link', 'View image');
                    link.href = href;
                    link.target = '_blank';
                    link.rel = 'noopener noreferrer';
                    lines.push(link);
                }
                return card(r.imaging_type, lines, r.created_at);
            }
        },
        bills: {
            table: 'billing',
            columns: 'billing_id, amount, description, created_at',
            render: (r) => card(formatMoney(r.amount), [r.description], r.created_at)
        }
    };

    async function showTab(name) {
        const tab = TABS[name];
        document.querySelectorAll('#pt-tabs button').forEach((b) => {
            b.classList.toggle('active', b.dataset.tab === name);
        });
        const box = $('pt-content');
        $('pt-msg').textContent = '';
        box.replaceChildren();

        if (!loaded[name]) {
            const { data, error } = await sb
                .from(tab.table)
                .select(tab.columns)
                .order('created_at', { ascending: false })
                .limit(50);
            if (error) {
                $('pt-msg').textContent = 'Could not load records';
                return;
            }
            loaded[name] = { rows: data || [], extra: tab.extra ? await tab.extra() : null };
        }

        // Ignore a slow reply if the patient already switched tabs.
        const active = document.querySelector('#pt-tabs button.active');
        if (!active || active.dataset.tab !== name) return;

        const { rows, extra } = loaded[name];
        if (!rows.length) {
            box.appendChild(el('p', 'acc-empty', 'No records'));
            return;
        }
        rows.forEach((row) => box.appendChild(tab.render(row, extra)));
    }

    window.initPatient = function () {
        if (started) return;
        started = true;
        $('patient-panel').hidden = false;
        document.querySelectorAll('#pt-tabs button').forEach((b) => {
            b.addEventListener('click', () => showTab(b.dataset.tab));
        });
        showTab('vitals');
    };
})();
