import { REACTION_PICKER_EMOJIS } from './reactions.js';
import { escapeHtml } from './utils.js';

const QUICK_REACTION_EMOJIS_LIMIT = 7;

export function syncReactionPickerItems(reactionPicker) {
    if (!reactionPicker) return;
    const emojis = Array.isArray(REACTION_PICKER_EMOJIS)
        ? REACTION_PICKER_EMOJIS.map((item) => String(item || '').trim()).filter(Boolean)
        : [];
    if (!emojis.length) return;

    const buildEmojiButtonHtml = (emoji) => (
        `<button type="button" class="reaction-picker__item" data-emoji="${escapeHtml(emoji)}" aria-label="\u0420\u0435\u0430\u043A\u0446\u0438\u044F ${escapeHtml(emoji)}">${escapeHtml(emoji)}</button>`
    );

    const quickEmojis = emojis.slice(0, QUICK_REACTION_EMOJIS_LIMIT);
    const expandedEmojis = emojis.slice(QUICK_REACTION_EMOJIS_LIMIT);
    const hasExpandedSection = expandedEmojis.length > 0;

    reactionPicker.innerHTML = `
        <div class="reaction-picker__row">
            <div class="reaction-picker__quick">${quickEmojis.map(buildEmojiButtonHtml).join('')}</div>
            ${hasExpandedSection
        ? `<button type="button" class="reaction-picker__expand-toggle" data-reaction-expand-toggle aria-label="\u0411\u043E\u043B\u044C\u0448\u0435 \u0440\u0435\u0430\u043A\u0446\u0438\u0439" aria-expanded="false"><i class="bi bi-chevron-down" aria-hidden="true"></i></button>`
        : ''}
        </div>
        ${hasExpandedSection
        ? `<div class="reaction-picker__expanded" hidden>${expandedEmojis.map(buildEmojiButtonHtml).join('')}</div>`
        : ''}
    `;
}
