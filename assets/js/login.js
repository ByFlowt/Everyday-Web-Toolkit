// Page script for index.html: login form and dashboard greeting.
import { isCryptoAvailable, verifyLogin } from './auth.js';
import { USERS } from './users.js';

const guard = globalThis.sessionGuard;

const form = document.getElementById('loginForm');
const nameInput = document.getElementById('nameInput');
const passwordInput = document.getElementById('passwordInput');
const button = document.getElementById('loginButton');
const notice = document.getElementById('loginNotice');
const errorMessage = document.getElementById('loginError');
const welcome = document.getElementById('welcomeMessage');

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

// Live regions only change when the text does, so repeated session checks are not re-announced.
function setText(element, text) {
    if (element.textContent !== text) {
        element.textContent = text;
    }
}

let shownState = null;

function render() {
    const status = guard.getStatus();
    if (status.state === 'active') {
        setText(welcome, status.userName ? `Willkommen zurück, ${status.userName}!` : 'Willkommen zurück!');
        setText(notice, '');
        setText(errorMessage, '');
        if (shownState === 'login') {
            form.reset();
            welcome.focus();
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
