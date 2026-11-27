// Lightweight redirect for legacy bookmark URLs (Converter.html, TimeCalculator.html).
(function () {
    'use strict';

    const route = document.documentElement.dataset.redirect;
    if (route === 'converter' || route === 'calculator') {
        window.location.replace(`index.html#${route}`);
    } else {
        window.location.replace('index.html');
    }
})();
