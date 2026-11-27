// Converter view controller (embedded in index.html). All model output is rendered with textContent.
import { convertText, GeminiError } from './gemini.js';
import { createKeyControls, createKeyStore } from './key-store.js';
import { setupSecretField } from './secret-field.js';

const MODE_DESCRIPTIONS = Object.freeze({
    royal: 'Barocker Kanzleistil des Heiligen Römischen Reiches mit erhabener Eleganz.',
    youth: 'Locker, direkt und in entspannter WhatsApp-Kleinschreibung.',
    linkedin: 'Dramatisches Business-Broetry mit Hook, Takeaways und Community-Frage.'
});

const SAMPLE_TEXT = 'Ich mache heute etwas früher Feierabend, weil alle Aufgaben erledigt sind und das Design-Update live ist.';

export function initConverter({ setNavBusy } = {}) {
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
    const convertMenuToggle = element('convertMenuToggle');
    const convertQuickMenu = element('convertQuickMenu');
    const convertAndCopyAction = element('convertAndCopyAction');
    const insertSampleAction = element('insertSampleAction');
    const clearAllConverterAction = element('clearAllConverterAction');

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
    let lastUser = null;

    function setKeyPanelOpen(open) {
        keyPanelBody.hidden = !open;
        toggleKeyPanelButton.setAttribute('aria-expanded', String(open));
        toggleKeyPanelLabel.textContent = open ? 'Einklappen' : 'Key verwalten';
    }

    function setMenuOpen(open) {
        convertQuickMenu.hidden = !open;
        convertMenuToggle.setAttribute('aria-expanded', String(open));
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
        for (const control of [convertButton, convertMenuToggle, deleteKeyButton, modePicker]) {
            control.disabled = busy;
        }
        loadingIndicator.hidden = !busy;
        cancelButton.hidden = !busy;
        setNavBusy?.('converter', busy);
        updateOutputChrome();
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

    async function convert({ autoCopy = false } = {}) {
        setMenuOpen(false);
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
            if (autoCopy) {
                await copyResult();
            } else {
                showMessages(result.truncated
                    ? 'Hinweis: Die Antwort wurde wegen der Längenbegrenzung gekürzt.'
                    : 'Fertig.');
            }
        } catch (error) {
            if (!(error instanceof GeminiError)) {
                showMessages('', 'Unerwarteter Fehler. Bitte versuche es erneut.');
            } else if (error.kind === 'cancelled') {
                showMessages(error.message);
            } else {
                showMessages('', error.message);
            }
        } finally {
            const restoreFocus = [cancelButton, document.body].includes(document.activeElement);
            request = null;
            setBusy(false);
            if (restoreFocus) {
                convertButton.focus();
            }
        }
    }

    function syncSession() {
        const status = guard.getStatus();
        if (status.state !== 'active') {
            request?.abort();
            lastUser = null;
            keyInput.value = '';
            rememberSwitch.checked = false;
            setKeyVisible(false);
            textInput.value = '';
            output.textContent = '';
            showMessages('');
            updateCount();
            updateKeyStatus();
            setKeyPanelOpen(true);
            setMenuOpen(false);
            return;
        }
        const nextUser = status.userName ?? '';
        if (lastUser !== nextUser) {
            lastUser = nextUser;
            keyControls.restore();
            updateKeyStatus();
            setKeyPanelOpen(keyInput.value.trim().length === 0);
        }
    }

    syncSession();
    updateCount();
    updateModeDescription();
    updateOutputChrome();

    // Only these two user edits write the key. Converting never does.
    keyInput.addEventListener('input', keyControls.persist);
    // Saving replaces the previous copy, so switching off removes the localStorage entry at once.
    rememberSwitch.addEventListener('change', keyControls.persist);

    keyInput.addEventListener('input', updateKeyStatus);
    rememberSwitch.addEventListener('change', updateKeyStatus);

    document.addEventListener('sessionchange', syncSession);
    window.addEventListener('storage', (event) => {
        keyControls.sync(event.key);
        updateKeyStatus();
    });
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
    convertButton.addEventListener('click', () => convert());
    convertMenuToggle.addEventListener('click', () => setMenuOpen(convertQuickMenu.hidden));

    convertAndCopyAction.addEventListener('click', () => convert({ autoCopy: true }));
    insertSampleAction.addEventListener('click', () => {
        setMenuOpen(false);
        textInput.value = SAMPLE_TEXT;
        updateCount();
        textInput.focus();
    });
    clearAllConverterAction.addEventListener('click', () => {
        setMenuOpen(false);
        textInput.value = '';
        output.textContent = '';
        showMessages('');
        updateCount();
        textInput.focus();
    });

    document.addEventListener('click', (event) => {
        if (convertQuickMenu.hidden) return;
        const target = event.target;
        if (target instanceof Node && !convertQuickMenu.contains(target) && !convertMenuToggle.contains(target)) {
            setMenuOpen(false);
        }
    });
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && !convertQuickMenu.hidden) {
            setMenuOpen(false);
            convertMenuToggle.focus();
        }
    });

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

    window.addEventListener('pagehide', () => request?.abort());

    return {
        openKeyPanel: () => {
            setKeyPanelOpen(true);
            keyInput.focus();
        }
    };
}
