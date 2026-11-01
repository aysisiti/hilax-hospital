// Patient panel: the signed-in patient's own records, read-only.
// The database only returns rows that belong to this patient, so there is no
// patient id in these requests.

(function () {
    const { el, TABS, load } = window.HilaxRecords;
    const TAB_ORDER = ['vitals', 'prescriptions', 'labs', 'imaging', 'bills'];
    let started = false;
    let myId = null;
    const loaded = {};

    const $ = (id) => document.getElementById(id);

    async function showTab(name) {
        document.querySelectorAll('#pt-tabs button').forEach((b) => {
            b.classList.toggle('active', b.dataset.tab === name);
        });
        const box = $('pt-content');
        $('pt-msg').textContent = '';
        box.replaceChildren();

        if (!loaded[name]) {
            const result = await load(name);
            if (!result) {
                $('pt-msg').textContent = 'Could not load records';
                return;
            }
            loaded[name] = result;
        }

        // Ignore a slow reply if the patient already switched tabs.
        const active = document.querySelector('#pt-tabs button.active');
        if (!active || active.dataset.tab !== name) return;

        const { rows, extra } = loaded[name];
        if (!rows.length) {
            box.appendChild(el('p', 'acc-empty', 'No records'));
            return;
        }
        rows.forEach((row) => box.appendChild(TABS[name].render(row, extra, { myId: myId })));
    }

    window.initPatient = function (profile) {
        if (started) return;
        started = true;
        myId = profile && profile.id;
        $('patient-panel').hidden = false;
        document.querySelectorAll('#pt-tabs button').forEach((b) => {
            if (TAB_ORDER.includes(b.dataset.tab)) b.addEventListener('click', () => showTab(b.dataset.tab));
        });
        showTab('vitals');
    };
})();
