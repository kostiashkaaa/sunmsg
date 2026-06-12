// Report flow: the modal for reporting a message/user.
// Includes status polling and API response handling. Extracted from chat.js
// with no behavior change.

function waitMs(durationMs) {
    return new Promise((resolve) => {
        window.setTimeout(resolve, Math.max(0, Number(durationMs) || 0));
    });
}

function createIdempotencyKey() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
        return window.crypto.randomUUID();
    }
    const entropy = Math.random().toString(36).slice(2);
    return `mrep-${Date.now()}-${entropy}`;
}

export function createChatReportFlow(deps = {}) {
    const {
        reportContentModal,
        reportContentTargetLabel,
        reportReasonSelect,
        reportCommentInput,
        reportContentStatus,
        reportSubmitBtn,
        reportCancelBtn,
        withAppRoot,
        getCsrfToken,
        openAnimatedDialog,
        closeAnimatedDialog,
        showToast,
    } = deps;

    let reportSubmitInFlight = false;
    let reportModalTarget = null;

    function setReportStatus(text, tone = 'info') {
        if (!reportContentStatus) return;
        reportContentStatus.textContent = String(text || '');
        reportContentStatus.dataset.tone = String(tone || 'info');
    }

    function resetReportModalForm() {
        if (reportReasonSelect) {
            reportReasonSelect.value = 'spam';
        }
        if (reportCommentInput) {
            reportCommentInput.value = '';
        }
        setReportStatus('');
        reportSubmitInFlight = false;
        if (reportSubmitBtn) {
            reportSubmitBtn.disabled = false;
        }
    }

    function describeReportTarget(target = null) {
        if (!target) return 'Report target is not selected.';
        if (target.targetType === 'message') {
            const safeMessageId = String(target.messageId || target.targetId || '').trim();
            const preview = String(target.preview || '').trim();
            if (preview) {
                return `Report target: message #${safeMessageId || target.targetId}. "${preview}"`;
            }
            return `Report target: message #${target.targetId}.`;
        }
        if (target.targetType === 'user') {
            const safeUserId = String(target.targetId || '').trim();
            const username = String(target.username || '').trim();
            if (username) {
                return `Report target: user #${safeUserId} (@${username}).`;
            }
            const display = String(target.displayName || '').trim();
            if (display) {
                return `Report target: user #${safeUserId} (${display}).`;
            }
            return `Report target: user #${target.targetId}.`;
        }
        return `Report target: ${target.targetType || 'unknown'} #${target.targetId}`;
    }

    async function pollReportStatus(reportId, { maxAttempts = 5, intervalMs = 1500 } = {}) {
        const safeReportId = Number.parseInt(reportId, 10);
        if (!Number.isFinite(safeReportId) || safeReportId <= 0) return null;
        for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
            if (attempt > 0) {
                await waitMs(intervalMs);
            }
            try {
                const response = await fetch(withAppRoot(`/api/moderation/reports/${safeReportId}`), {
                    method: 'GET',
                    headers: { Accept: 'application/json' },
                });
                const payload = await response.json();
                if (!response.ok || !payload?.success) continue;
                const status = String(payload.status || '').toLowerCase();
                if (status === 'closed') {
                    return payload;
                }
                if (status === 'triaged') {
                    return payload;
                }
            } catch (_) {}
        }
        return null;
    }

    function openReportModal(target) {
        if (!reportContentModal) return;
        reportModalTarget = target || null;
        if (reportContentTargetLabel) {
            reportContentTargetLabel.textContent = describeReportTarget(reportModalTarget);
        }
        resetReportModalForm();
        openAnimatedDialog(reportContentModal, { focusTarget: reportReasonSelect || reportCommentInput });
    }

    async function submitReportFromModal() {
        if (reportSubmitInFlight) return;
        if (!reportModalTarget?.targetType || !reportModalTarget?.targetId) {
            setReportStatus('Cannot submit report: target is missing.', 'error');
            return;
        }
        reportSubmitInFlight = true;
        if (reportSubmitBtn) {
            reportSubmitBtn.disabled = true;
        }
        setReportStatus('Sending report...', 'info');
        const idempotencyKey = createIdempotencyKey();
        const reasonCode = String(reportReasonSelect?.value || 'abuse').trim().toLowerCase() || 'abuse';
        const comment = String(reportCommentInput?.value || '').trim();
        const payload = {
            target_type: String(reportModalTarget.targetType),
            target_id: String(reportModalTarget.targetId),
            reason_code: reasonCode,
            comment,
            client_event_id: idempotencyKey,
        };
        if (Number.isFinite(Number(reportModalTarget.messageId)) && Number(reportModalTarget.messageId) > 0) {
            payload.message_id = Number(reportModalTarget.messageId);
        }
        try {
            const response = await fetch(withAppRoot('/api/moderation/reports'), {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Accept: 'application/json',
                    'X-CSRFToken': getCsrfToken(),
                    'Idempotency-Key': idempotencyKey,
                },
                body: JSON.stringify(payload),
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok || !data?.success) {
                const errorCode = String(data?.error || '').trim();
                if (errorCode === 'idempotency_key_required') {
                    setReportStatus('Повтор не выполнен: требуется ключ идемпотентности.', 'error');
                } else if (errorCode === 'invalid_target') {
                    setReportStatus('Цель жалобы указана некорректно.', 'error');
                } else {
                    setReportStatus('Не удалось отправить жалобу. Попробуйте ещё раз.', 'error');
                }
                return;
            }
            setReportStatus('Жалоба принята. Проверяем статус...', 'success');
            const resolved = await pollReportStatus(data.report_id, { maxAttempts: 6, intervalMs: 1500 });
            if (resolved) {
                const status = String(resolved.status || '').toLowerCase();
                if (status === 'closed') {
                    setReportStatus('Жалоба автоматически закрыта.', 'success');
                } else if (status === 'triaged') {
                    setReportStatus('Жалоба передана на проверку модератору.', 'success');
                } else {
                    setReportStatus('Жалоба получена.', 'success');
                }
            } else {
                setReportStatus('Жалоба получена и поставлена в очередь.', 'success');
            }
            showToast('Жалоба отправлена.', 'success');
            window.setTimeout(() => {
                if (!reportContentModal?.open) return;
                closeAnimatedDialog(reportContentModal);
            }, 650);
        } catch (_) {
            setReportStatus('Сетевая ошибка при отправке жалобы.', 'error');
        } finally {
            reportSubmitInFlight = false;
            if (reportSubmitBtn) {
                reportSubmitBtn.disabled = false;
            }
        }
    }

    // Wiring
    reportSubmitBtn?.addEventListener('click', () => {
        void submitReportFromModal();
    });
    reportCancelBtn?.addEventListener('click', () => {
        reportModalTarget = null;
        resetReportModalForm();
    });
    reportContentModal?.addEventListener('close', () => {
        reportModalTarget = null;
        resetReportModalForm();
    });

    return {
        openReportModal,
    };
}
