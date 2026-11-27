// Page script for Converter.html. All model output is rendered with textContent.
import { convertText, GeminiError } from './gemini.js';
import { createKeyControls, createKeyStore } from './key-store.js';
import { setupSecretField } from './secret-field.js';
import { initShell } from './shell.js';

initShell();

const guard = globalThis.sessionGuard;
const keyStore = createKeyStore({
    getLocal: () => window.localStorage,
    getSession: () => window.sessionStorage,
    getUserName: () => guard.getStatus().userName ?? '',
    keys: globalThis.Session.KEYS
});

const MODE_DESCRIPTIONS = Object.freeze({
    royal: 'Würdevoll und archaisch im Stile des Heiligen Römischen Reiches.',
    youth: 'Locker, direkt und in typischer WhatsApp-Kleinschreibung.',
    linkedin: 'Maximaler Business-Pathos mit Broetry-Umbrüchen und Denglisch.'
});

const element = (id) => document.getElementById(id);
const keyInput = element('apiKey');
const toggleKeyButton = element('toggleKey');
const rememberSwitch = element('rememberKey');
const deleteKeyButton = element('deleteKey');
const keyPanelBody = element('keyPanelBody');
const toggleKeyPanelButton = element('toggleKeyPanel');
const toggleKeyPanelLabel = element('toggleKeyPanelLabel');
const keyStatusBadge = element('keyStatusBadge');
const keyStatusIcon = element('keyStatusIcon');
const keyStatusText = element('keyStatusText');

const textInput = element('inputText');
const clearInputButton = element('clearInputButton');
const charCount = element('charCount');
const modePicker = element('modePicker');
const modeDescription = element('modeDescription');
const convertButton = element('convertButton');
const cancelButton = element('cancelButton');
const loadingIndicator = element('loadingIndicator');
const statusMessage = element('status');
const errorMessage = element('error');
const outputPlaceholder = element('outputPlaceholder');
const output = element('output');
const resultToolbar = element('resultToolbar');
const copyButton = element('copyButton');
const copyIcon = element('copyIcon');
const copyLabel = element('copyLabel');
const reuseButton = element('reuseButton');
const clearOutputButton = element('clearOutputButton');

const keyField = setupSecretField(keyInput);
const keyControls = createKeyControls({
    keyStore,
    keys: globalThis.Session.KEYS,
    input: keyInput,
    rememberSwitch,
    isSessionValid: () => guard.isPageUserSignedIn(),
    onSaveError: () => showMessages('', 'Der API-Key konnte nicht gespeichert werden.')
});

let request = null;
let copyTimer;

function setKeyPanelOpen(open) {
    keyPanelBody.hidden = !open;
    toggleKeyPanelButton.setAttribute('aria-expanded', String(open));
    toggleKeyPanelLabel.textContent = open ? 'Einklappen' : 'Key verwalten';
}

function updateKeyStatus() {
    const hasKey = keyInput.value.trim().length > 0;
    if (!hasKey) {
        keyStatusIcon.textContent = 'key_off';
        keyStatusText.textContent = 'API-Key erforderlich';
        delete keyStatusBadge.dataset.tone;
        return;
    }
    keyStatusIcon.textContent = 'verified_user';
    keyStatusText.textContent = rememberSwitch.checked ? 'API-Key gemerkt' : 'API-Key aktiv (Tab)';
    keyStatusBadge.dataset.tone = 'primary';
}

function updateOutputChrome() {
    const hasOutput = output.textContent.trim().length > 0;
    const hasError = errorMessage.textContent.trim().length > 0;
    const isBusy = request !== null;
    resultToolbar.hidden = !hasOutput;
    outputPlaceholder.hidden = hasOutput || hasError || isBusy;
}

function showMessages(status, error = '') {
    statusMessage.textContent = status;
    errorMessage.textContent = error;
    updateOutputChrome();
}

function updateCount() {
    const len = textInput.value.length;
    charCount.textContent = `${len} / ${textInput.maxLength} Zeichen`;
    charCount.dataset.warn = String(len >= Math.floor(textInput.maxLength * 0.9));
    clearInputButton.hidden = len === 0;
}

function updateModeDescription() {
    const selected = modePicker.querySelector('input:checked')?.value ?? 'royal';
    modeDescription.textContent = MODE_DESCRIPTIONS[selected] ?? '';
}

function setKeyVisible(visible) {
    keyField.setVisible(visible);
    toggleKeyButton.setAttribute('aria-pressed', String(visible));
    const label = visible ? 'API-Key verbergen' : 'API-Key anzeigen';
    toggleKeyButton.setAttribute('aria-label', label);
    toggleKeyButton.setAttribute('title', label);
    const icon = toggleKeyButton.querySelector('.material-symbols-outlined');
    if (icon) {
        icon.textContent = visible ? 'visibility_off' : 'visibility';
    }
}

function setBusy(busy) {
    for (const control of [convertButton, deleteKeyButton, modePicker]) {
        control.disabled = busy;
    }
    loadingIndicator.hidden = !busy;
    cancelButton.hidden = !busy;
    updateOutputChrome();
}

async function convert() {
    if (request) {
        return;
    }
    const apiKey = keyInput.value.trim();
    const text = textInput.value.trim();
    if (!apiKey) {
        setKeyPanelOpen(true);
        showMessages('', 'Bitte gib deinen API-Key ein.');
        keyInput.focus();
        return;
    }
    if (!text) {
        showMessages('', 'Bitte gib einen Text ein.');
        textInput.focus();
        return;
    }

    const mode = modePicker.querySelector('input:checked').value;
    request = new AbortController();
    output.textContent = '';
    showMessages('Wird umgewandelt …');
    setBusy(true);
    cancelButton.focus();
    try {
        const result = await convertText({ apiKey, text, mode, signal: request.signal });
        output.textContent = result.text;
        showMessages(result.truncated
            ? 'Hinweis: Die Antwort wurde wegen der Längenbegrenzung gekürzt.'
            : 'Fertig.');
    } catch (error) {
        if (!(error instanceof GeminiError)) {
            showMessages('', 'Unerwarteter Fehler. Bitte versuche es erneut.');
        } else if (error.kind === 'cancelled') {
            showMessages(error.message);
        } else {
            showMessages('', error.message);
        }
    } finally {
        // Give focus back only if it was on the vanishing cancel button.
        const restoreFocus = [cancelButton, document.body].includes(document.activeElement);
        request = null;
        setBusy(false);
        if (restoreFocus) {
            convertButton.focus();
        }
    }
}

async function copyResult() {
    clearTimeout(copyTimer);
    try {
        await navigator.clipboard.writeText(output.textContent);
        copyLabel.textContent = 'Kopiert!';
        copyIcon.textContent = 'check';
        showMessages('In die Zwischenablage kopiert.');
        copyTimer = setTimeout(() => {
            copyLabel.textContent = 'Kopieren';
            copyIcon.textContent = 'content_copy';
        }, 2000);
    } catch {
        copyLabel.textContent = 'Kopieren';
        copyIcon.textContent = 'content_copy';
        showMessages('', 'Kopieren fehlgeschlagen. Bitte markiere den Text und kopiere ihn manuell.');
    }
}

keyControls.restore();
updateKeyStatus();
setKeyPanelOpen(keyInput.value.trim().length === 0);
updateCount();
updateModeDescription();
updateOutputChrome();

// Only these two user edits write the key. Converting never does.
keyInput.addEventListener('input', keyControls.persist);
// Saving replaces the previous copy, so switching off removes the localStorage entry at once.
rememberSwitch.addEventListener('change', keyControls.persist);

keyInput.addEventListener('input', updateKeyStatus);
rememberSwitch.addEventListener('change', updateKeyStatus);

window.addEventListener('storage', (event) => {
    keyControls.sync(event.key);
    updateKeyStatus();
});
// A page from the back/forward cache may have missed "storage" events.
window.addEventListener('pageshow', (event) => {
    if (event.persisted) {
        keyControls.restore();
        updateKeyStatus();
        setKeyPanelOpen(keyInput.value.trim().length === 0);
    }
});

toggleKeyPanelButton.addEventListener('click', () => {
    setKeyPanelOpen(keyPanelBody.hidden);
});
toggleKeyButton.addEventListener('click', () => setKeyVisible(!keyField.isVisible()));
deleteKeyButton.addEventListener('click', () => {
    keyInput.value = '';
    rememberSwitch.checked = false;
    setKeyVisible(false);
    updateKeyStatus();
    if (keyStore.clear()) {
        showMessages('API-Key gelöscht.');
    } else {
        showMessages('', 'Der gespeicherte API-Key konnte nicht gelöscht werden.');
    }
});

textInput.addEventListener('input', updateCount);
textInput.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault();
        convert();
    }
});
clearInputButton.addEventListener('click', () => {
    textInput.value = '';
    updateCount();
    textInput.focus();
});

modePicker.addEventListener('change', updateModeDescription);
convertButton.addEventListener('click', convert);
cancelButton.addEventListener('click', () => request?.abort());
copyButton.addEventListener('click', copyResult);

reuseButton.addEventListener('click', () => {
    const text = output.textContent.trim();
    if (!text) return;
    textInput.value = text.slice(0, textInput.maxLength);
    updateCount();
    textInput.focus();
});

clearOutputButton.addEventListener('click', () => {
    output.textContent = '';
    showMessages('');
});

// Logout or expiry leaves the page: stop a running request.
window.addEventListener('pagehide', () => request?.abort());
