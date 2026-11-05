// Shared by the patient and staff views: how each kind of record is loaded and
// drawn. The database decides which rows come back (row-level security).

window.HilaxRecords = (function () {
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

    // Images sit in a private bucket: ask for a short-lived link each time one is opened.
    function imageControl(path) {
        const wrap = el('div', 'rec-image');
        const button = el('button', 'btn-small', 'View image');
        button.type = 'button';
        const note = el('span', 'form-msg');
        let img = null;
        button.addEventListener('click', async () => {
            if (img) {
                img.remove();
                img = null;
                button.textContent = 'View image';
                return;
            }
            button.disabled = true;
            note.textContent = '';
            const { data, error } = await sb.storage.from('imaging').createSignedUrl(path, 300);
            button.disabled = false;
            if (error || !data || !data.signedUrl) {
                note.textContent = 'Could not load image';
                return;
            }
            img = el('img', 'rec-img');
            img.alt = 'Imaging result';
            img.addEventListener('error', () => {
                note.textContent = 'Could not load image';
                if (img) img.remove();
                img = null;
                button.textContent = 'View image';
            });
            img.src = data.signedUrl;
            wrap.appendChild(img);
            button.textContent = 'Hide image';
        });
        wrap.append(button, note);
        return wrap;
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

    // What each kind of record shows and how to read it.
    // render(row, extra, ctx): ctx.myId is the signed-in user's id.
    const TABS = {
        vitals: {
            label: 'Vitals',
            table: 'vitals',
            columns: 'vitals_id, nurse_id, heart_rate, blood_pressure, temperature, created_at',
            render: (r, extra, ctx) => card(
                'BP ' + r.blood_pressure,
                ['Heart rate ' + r.heart_rate + ' bpm', 'Temperature ' + r.temperature + ' °C'],
                r.created_at,
                ctx && ctx.myId && r.nurse_id === ctx.myId ? 'You' : null)
        },
        prescriptions: {
            label: 'Prescriptions',
            table: 'prescriptions',
            columns: 'prescription_id, medication_name, dosage, frequency, created_at',
            extra: async (rows) => {
                const map = {};
                if (!rows.length) return map;
                const { data } = await sb
                    .from('dispense_logs')
                    .select('prescription_id, dispensed_at')
                    .in('prescription_id', rows.map((r) => r.prescription_id));
                (data || []).forEach((d) => { map[d.prescription_id] = d.dispensed_at; });
                return map;
            },
            render: (r, dispensed, ctx) => {
                const done = dispensed[r.prescription_id];
                const lines = [
                    r.dosage + ' · ' + r.frequency,
                    done ? 'Dispensed ' + formatDate(done) : null
                ];
                // Pharmacists get a Dispense control on prescriptions not yet dispensed.
                if (!done && ctx && ctx.prescriptionAction) lines.push(ctx.prescriptionAction(r));
                return card(r.medication_name, lines, r.created_at, done ? 'Dispensed' : null);
            }
        },
        labs: {
            label: 'Lab results',
            table: 'lab_results',
            columns: 'lab_id, test_name, results, created_at',
            render: (r) => card(r.test_name, [r.results], r.created_at)
        },
        imaging: {
            label: 'Imaging',
            table: 'imaging_results',
            columns: 'imaging_id, imaging_type, findings, image_path, created_at',
            render: (r) => {
                const lines = [r.findings];
                if (r.image_path) lines.push(imageControl(r.image_path));
                return card(r.imaging_type, lines, r.created_at);
            }
        },
        bills: {
            label: 'Bills',
            table: 'billing',
            columns: 'billing_id, amount, description, created_at, paid_at',
            render: (r) => card(formatMoney(r.amount), [r.description, r.paid_at ? 'Paid ' + formatDate(r.paid_at) : 'Unpaid'], r.created_at, r.paid_at ? 'Paid' : null)
        }
    };

    // Newest 50 records of one kind, optionally for one patient.
    // Returns null if the load failed.
    async function load(name, patientId) {
        const tab = TABS[name];
        let query = sb.from(tab.table).select(tab.columns)
            .order('created_at', { ascending: false })
            .limit(50);
        if (patientId) query = query.eq('patient_id', patientId);
        const { data, error } = await query;
        if (error) return null;
        const rows = data || [];
        return { rows: rows, extra: tab.extra ? await tab.extra(rows) : null };
    }

    return { el, formatDate, formatMoney, TABS, load };
})();
