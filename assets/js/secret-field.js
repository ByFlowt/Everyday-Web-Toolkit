// A secret input that password managers should leave alone: a text field masked by CSS.
// Browsers without that mask get a password field instead. The element is injected, so tests can pass a fake.

export function hasCssMask(input) {
    // The computed value also proves that the stylesheet with the mask really applies.
    return CSS.supports('-webkit-text-security', 'disc')
        && getComputedStyle(input).getPropertyValue('-webkit-text-security') === 'disc';
}

// The markup ships the input disabled; it is enabled here, once it is certainly masked.
export function setupSecretField(input, isCssMasked = hasCssMask) {
    const cssMask = isCssMasked(input);

    function setVisible(visible) {
        input.classList.toggle('is-revealed', visible);
        if (!cssMask) {
            input.type = visible ? 'text' : 'password';
        }
    }

    if (!cssMask) {
        input.autocomplete = 'new-password';
    }
    setVisible(false);
    input.disabled = false;

    return { setVisible, isVisible: () => input.classList.contains('is-revealed') };
}
