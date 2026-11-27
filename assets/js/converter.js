// Page script for Converter.html. All model output is rendered with textContent.
import { convertText, GeminiError } from './gemini.js';
import { createKeyControls, createKeyStore } from './key-store.js';
import { setupSecretField } from './secret-field.js';

const guard = globalThis.sessionGuard;
const keyStore = createKeyStore({
    getLocal: () => window.localStorage,
    getSession: () => window.sessionStorage,
    getUserName: () => guard.getStatus().userName ?? '',
    keys: globalThis.Session.KEYS
});

const element = (id) => document.getElementById(id);
const keyInput = element('apiKey');
const toggleKeyButton = element('toggleKey');
const rememberSwitch = element('rememberKey');
const deleteKeyButton = element('deleteKey');
const textInput = element('inputText');
const charCount = element('charCount');
const modePicker = element('modePicker');
const convertButton = element('convertButton');
const cancelButton = element('cancelButton');
const loadingIndicator = element('loadingIndicator');
const statusMessage = element('status');
const errorMessage = element('error');
const output = element('output');
const copyButton = element('copyButton');
const copyLabel = element('copyLabel');

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

function showMessages(status, error = '') {
    statusMessage.textContent = status;
    errorMessage.textContent = error;
}

function updateCount() {
    charCount.textContent = `${textInput.value.length} / ${textInput.maxLength} Zeichen`;
}

function setKeyVisible(visible) {
    keyField.setVisible(visible);
    toggleKeyButton.setAttribute('aria-pressed', String(visible));
}

function setBusy(busy) {
    for (const control of [convertButton, deleteKeyButton, modePicker]) {
        control.disabled = busy;
    }
    loadingIndicator.hidden = !busy;
    cancelButton.hidden = !busy;
}

async function convert() {
    if (request) {
        return;
    }
    const apiKey = keyInput.value.trim();
    const text = textInput.value.trim();
    if (!apiKey) {
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
    copyButton.hidden = true;
    showMessages('Wird umgewandelt …');
    setBusy(true);
    cancelButton.focus();
    try {
        const result = await convertText({ apiKey, text, mode, signal: request.signal });
        output.textContent = result.text;
        copyButton.hidden = false;
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
        showMessages('In die Zwischenablage kopiert.');
        copyTimer = setTimeout(() => { copyLabel.textContent = 'Kopieren'; }, 2000);
    } catch {
        copyLabel.textContent = 'Kopieren';
        showMessages('', 'Kopieren fehlgeschlagen. Bitte markiere den Text und kopiere ihn manuell.');
    }
}

keyControls.restore();
updateCount();

// Only these two user edits write the key. Converting never does.
keyInput.addEventListener('input', keyControls.persist);
// Saving replaces the previous copy, so switching off removes the localStorage entry at once.
rememberSwitch.addEventListener('change', keyControls.persist);
window.addEventListener('storage', (event) => keyControls.sync(event.key));
// A page from the back/forward cache may have missed "storage" events.
window.addEventListener('pageshow', (event) => {
    if (event.persisted) {
        keyControls.restore();
    }
});
toggleKeyButton.addEventListener('click', () => setKeyVisible(!keyField.isVisible()));
deleteKeyButton.addEventListener('click', () => {
    keyInput.value = '';
    rememberSwitch.checked = false;
    setKeyVisible(false);
    if (keyStore.clear()) {
        showMessages('API-Key gelöscht.');
    } else {
        showMessages('', 'Der gespeicherte API-Key konnte nicht gelöscht werden.');
    }
});
textInput.addEventListener('input', updateCount);
convertButton.addEventListener('click', convert);
cancelButton.addEventListener('click', () => request?.abort());
copyButton.addEventListener('click', copyResult);
// Logout or expiry leaves the page: stop a running request.
window.addEventListener('pagehide', () => request?.abort());
