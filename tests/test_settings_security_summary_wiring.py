from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_settings_security_summary_is_wired():
    template_src = (ROOT / 'templates' / 'settings' / '_panel.html').read_text(encoding='utf-8')
    module_src = (
        ROOT / 'static' / 'pages' / 'settings' / 'security-summary-section.js'
    ).read_text(encoding='utf-8')
    orchestrator_src = (
        ROOT / 'static' / 'pages' / 'settings' / 'orchestrator.js'
    ).read_text(encoding='utf-8')

    assert 'id="securitySummaryCard"' in template_src
    assert 'export function initSecuritySummarySection' in module_src
    assert "import { initSecuritySummarySection } from './security-summary-section.js';" in orchestrator_src
    assert 'initSecuritySummarySection({ tr });' in orchestrator_src
