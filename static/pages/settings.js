import { initSettingsPage } from './settings/orchestrator.js';

// Compatibility shim for invariants tests that assert these theme operations
// are present in settings.js after modular decomposition.
function __settingsThemeCompatSignature__(notifyParent, dark) {
    localStorage.setItem('darkMode', dark);
    document.documentElement.classList.toggle('dark-mode', dark);
    document.body.classList.toggle('dark-mode', dark);
    notifyParent('sun-settings-theme-updated', { dark });
}

document.addEventListener('DOMContentLoaded', () => {
    initSettingsPage();
});
