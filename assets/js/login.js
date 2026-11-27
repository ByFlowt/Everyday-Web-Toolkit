// SPA entry script for index.html: login form, adaptive shell, dashboard, converter, and calculator.
import { isCryptoAvailable, verifyLogin } from './auth.js';
import { initCalculator } from './calculator.js';
import { initConverter } from './converter.js';
import { createKeyStore } from './key-store.js';
import { initShell } from './shell.js';
import { calculate, loadUserState } from './time-calc.js';
import { USERS } from './users.js';

const shell = initShell();
const converter = initConverter({ setNavBusy: shell.setNavBusy });
const calculator = initCalculator();

const guard = globalThis.sessionGuard;
const keyStore = createKeyStore({
    getLocal: () => window.localStorage,
    getSession: () => window.sessionStorage,
    getUserName: () => guard.getStatus().userName ?? '',
    keys: globalThis.Session.KEYS
});

const form = document.getElementById('loginForm');
const nameInput = document.getElementById('nameInput');
const passwordInput = document.getElementById('passwordInput');
const togglePasswordButton = document.getElementById('toggleLoginPassword');
const button = document.getElementById('loginButton');
const notice = document.getElementById('loginNotice');
const errorMessage = document.getElementById('loginError');
const welcome = document.getElementById('welcomeMessage');
const dashboardDate = document.getElementById('dashboardDate');
const converterStatusChip = document.getElementById('converterStatusChip');
const calculatorStatusChip = document.getElementById('calculatorStatusChip');
const calculatorLivePreview = document.getElementById('calculatorLivePreview');
const quickStartNow = document.getElementById('quickStartNow');
const quickManageKey = document.getElementById('quickManageKey');

const STORAGE_PROBLEM = 'Der Browser-Speicher ist nicht verfügbar. Bitte erlaube Website-Daten, um dich anzumelden.';

function configurationProblem() {
    if (!isCryptoAvailable()) {
        return 'Die Anmeldung braucht eine sichere Verbindung (HTTPS oder localhost).';
    }
    if (USERS.length === 0) {
        return 'Es sind keine Benutzer konfiguriert. Die Seite muss zuerst mit Zugangsdaten gebaut werden.';
    }
    return '';
}

function setText(element, text) {
    if (element && element.textContent !== text) {
        element.textContent = text;
    }
}

function updatePasswordVisibility(visible) {
    passwordInput.type = visible ? 'text' : 'password';
    togglePasswordButton.setAttribute('aria-pressed', String(visible));
    const label = visible ? 'Passwort verbergen' : 'Passwort anzeigen';
    togglePasswordButton.setAttribute('aria-label', label);
    togglePasswordButton.setAttribute('title', label);
    const icon = togglePasswordButton.querySelector('.material-symbols-outlined');
    if (icon) {
        icon.textContent = visible ? 'visibility_off' : 'visibility';
    }
}

function formatGermanDate(date = new Date()) {
    try {
        return new Intl.DateTimeFormat('de-DE', {
            weekday: 'long',
            day: 'numeric',
            month: 'long'
        }).format(date);
    } catch {
        return 'Wähle ein Werkzeug für heute';
    }
}

function updateToolSummaries(userName) {
    setText(dashboardDate, `${formatGermanDate()} · Wähle dein Werkzeug`);

    const storedKey = keyStore.load();
    if (storedKey.key) {
        setText(converterStatusChip, storedKey.remember ? 'API-Key gemerkt' : 'API-Key aktiv');
        converterStatusChip.dataset.tone = 'primary';
    } else {
        setText(converterStatusChip, 'API-Key einrichten');
        delete converterStatusChip.dataset.tone;
    }

    if (!userName) {
        setText(calculatorStatusChip, 'Bereit');
        calculatorStatusChip.dataset.tone = 'primary';
        setText(calculatorLivePreview, 'Noch keine Startzeit gespeichert');
        return;
    }

    let state = {};
    try {
        state = loadUserState(window.localStorage, userName);
    } catch {
        state = {};
    }
    const calc = calculate(state);
    if (calc.ok) {
        setText(calculatorStatusChip, `Feierabend ${calc.endTime} Uhr`);
        calculatorStatusChip.dataset.tone = calc.dailyMinutes < 0 ? 'negative' : 'primary';
        setText(calculatorLivePreview, `Konto: ${calc.balance} · Start ${state.startTime}`);
    } else {
        setText(calculatorStatusChip, 'Startzeit festlegen');
        delete calculatorStatusChip.dataset.tone;
        setText(calculatorLivePreview, 'Noch keine Startzeit gespeichert');
    }
}

let shownState = null;

function render() {
    const status = guard.getStatus();
    if (status.state === 'active') {
        setText(welcome, status.userName ? `Willkommen zurück, ${status.userName}!` : 'Willkommen zurück!');
        setText(notice, '');
        setText(errorMessage, '');
        updateToolSummaries(status.userName ?? '');
        if (shownState === 'login') {
            form.reset();
            updatePasswordVisibility(false);
            if (shell.getRoute() === 'dashboard') {
                welcome.focus();
            }
        }
        shownState = 'dashboard';
        return;
    }
    setText(notice, guard.hasExpiredNotice() ? 'Deine Sitzung ist abgelaufen. Bitte melde dich erneut an.' : '');
    if (status.state === 'unavailable') {
        setText(errorMessage, STORAGE_PROBLEM);
    }
    if (shownState === 'dashboard') {
        nameInput.focus();
    }
    shownState = 'login';
}

function setChecking(checking) {
    button.disabled = checking;
    button.textContent = checking ? 'Wird geprüft …' : 'Anmelden';
    form.setAttribute('aria-busy', String(checking));
}

async function login() {
    const name = nameInput.value.trim();
    const password = passwordInput.value;
    setText(errorMessage, '');
    if (!name || !password.trim()) {
        setText(errorMessage, 'Bitte Name und Passwort eingeben.');
        return;
    }

    setChecking(true);
    try {
        const userName = await verifyLogin(USERS, name, password);
        if (userName === null) {
            setText(errorMessage, 'Name oder Passwort ist falsch.');
        } else if (!guard.start(userName)) {
            setText(errorMessage, STORAGE_PROBLEM);
        } else {
            guard.refresh();
        }
    } catch {
        setText(errorMessage, 'Die Anmeldung ist fehlgeschlagen. Bitte versuche es erneut.');
    } finally {
        setChecking(false);
    }
}

togglePasswordButton.addEventListener('click', () => {
    const currentlyVisible = togglePasswordButton.getAttribute('aria-pressed') === 'true';
    updatePasswordVisibility(!currentlyVisible);
});

quickStartNow.addEventListener('click', () => {
    calculator.startNow();
    shell.navigate('calculator');
});

quickManageKey.addEventListener('click', () => {
    shell.navigate('converter', { focusHeading: false });
    converter.openKeyPanel();
});

document.addEventListener('routechange', (event) => {
    const status = guard.getStatus();
    if (status.state === 'active' && event.detail?.route === 'dashboard') {
        updateToolSummaries(status.userName ?? '');
    }
});

window.addEventListener('storage', () => {
    const status = guard.getStatus();
    if (status.state === 'active') {
        updateToolSummaries(status.userName ?? '');
    }
});

window.addEventListener('pageshow', () => {
    const status = guard.getStatus();
    if (status.state === 'active') {
        updateToolSummaries(status.userName ?? '');
    }
});

document.addEventListener('sessionchange', render);
render();

const problem = configurationProblem();
if (problem) {
    setText(errorMessage, problem);
} else {
    form.addEventListener('submit', (event) => {
        event.preventDefault();
        if (!button.disabled) {
            login();
        }
    });
    // The button ships disabled, so the form cannot submit before this handler exists.
    button.disabled = false;
}
