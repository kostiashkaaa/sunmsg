(function () {
    const STORAGE_KEY = 'sun_ui_language';
    const SUPPORTED_LANGUAGES = new Set(['ru', 'en']);
    const LOCALE_MAPS = { ru: null, en: null };
    const LOCALE_LOADERS = new Map();

    const PHRASE_REPLACEMENTS_EN = [
        [/\u041F\u043E\u0436\u0430\u043B\u043E\u0432\u0430\u0442\u044C \u043D\u0430 \u043F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u044F/g, 'Report user'],
        [/\u041F\u0435\u0440\u0435\u0441\u043B\u0430\u0442\u044C \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u044F/g, 'Forward messages'],
        [/\u041F\u0435\u0440\u0435\u0441\u043B\u0430\u0442\u044C \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u0435/g, 'Forward message'],
        [/\u041F\u0435\u0440\u0435\u0441\u043B\u0430\u043D\u043E \u043E\u0442/g, 'Forwarded from'],
        [/\u041F\u0435\u0440\u0435\u0441\u043B\u0430\u0442\u044C (\d+) \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438[\\u0435\\u044F\\u0439]/g, 'Forward $1 messages'],
        [/\u041A\u043E\u043C\u0443 \u043F\u0435\u0440\u0435\u0441\u043B\u0430\u0442\u044C/g, 'Forward to'],
        [/\u0418\u043C\u044F, @username \u0438\u043B\u0438 chat_id/g, 'Name, @username or chat_id'],
        [/\u0421\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u0439: (\d+)\. \u0427\u0430\u0442\u043E\u0432: (\d+)\./g, 'Messages: $1. Chats: $2.'],
        [/\u0412\u044B\u0431\u0440\u0430\u043D\u043E \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u0439: (\d+)\./g, 'Selected messages: $1.'],
        [/\u0427\u0430\u0442\u044B \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u044B\./g, 'No chats found.'],
        [/\u0418\u0437\u0431\u0440\u0430\u043D\u043D\u043E\u0435/g, 'Saved Messages'],
        [/\u0413\u0440\u0443\u043F\u043F\u0430/g, 'Group'],
        [/\u041B\u0438\u0447\u043D\u044B\u0439 \u0447\u0430\u0442/g, 'Direct chat'],
        [/\u041E\u0442\u043A\u0440\u044B\u0442\u044C \u0447\u0430\u0442/g, 'Open chat'],
        [/\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u0447\u0430\u0442/g, 'Pick a chat'],
        [/\u0412\u044B\u0431\u0440\u0430\u043D\u043E/g, 'Selected'],
        [/\u0412\u044B\u0431\u0440\u0430\u0442\u044C/g, 'Select'],
        [/\u041F\u0435\u0440\u0435\u0441\u044B\u043B\u043A\u0430\.\.\./g, 'Forwarding...'],
        [/\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u0445\u043E\u0442\u044F \u0431\u044B \u043E\u0434\u0438\u043D \u0447\u0430\u0442 \u0434\u043B\u044F \u043F\u0435\u0440\u0435\u0441\u044B\u043B\u043A\u0438\./g, 'Select at least one chat to forward.'],
        [/\u041F\u0435\u0440\u0435\u0441\u043B\u0430\u043D\u043E \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u0439: (\d+)\./g, 'Forwarded messages: $1.'],
        [/\u0427\u0430\u0442 \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\. \u041E\u0431\u043D\u043E\u0432\u0438\u0442\u0435 \u0441\u043F\u0438\u0441\u043E\u043A \u043A\u043E\u043D\u0442\u0430\u043A\u0442\u043E\u0432\./g, 'Chat not found. Refresh contacts.'],
        [/\u0427\u0430\u0442 \u0434\u043B\u044F \u043F\u0435\u0440\u0435\u0441\u044B\u043B\u043A\u0438 \u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u0435\u043D\. \u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u043F\u043E\u043B\u0443\u0447\u0430\u0442\u0435\u043B\u044F \u0437\u0430\u043D\u043E\u0432\u043E\./g, 'Forward target is unavailable. Pick recipient again.'],
        [/\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u043F\u0435\u0440\u0435\u0441\u043B\u0430\u0442\u044C \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u044F\./g, 'Failed to forward messages.'],
        [/\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u043F\u043E\u0434\u0433\u043E\u0442\u043E\u0432\u0438\u0442\u044C \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u044F \u0434\u043B\u044F \u043F\u0435\u0440\u0435\u0441\u044B\u043B\u043A\u0438\./g, 'Failed to prepare messages for forwarding.'],
        [/\u041F\u043E\u0436\u0430\u043B\u043E\u0432\u0430\u0442\u044C \u043D\u0430 \u043A\u043E\u043D\u0442\u0435\u043D\u0442/g, 'Report content'],
        [/\u041D\u0443\u043B\u0435\u0432\u0430\u044F \u043E\u0441\u0432\u0435\u0434\u043E\u043C\u043B\u0451\u043D\u043D\u043E\u0441\u0442\u044C/g, 'Zero knowledge'],
        [/\u041E\u0442\u043A\u0440\u044B\u0442\u044B\u0439 \u0438\u0441\u0445\u043E\u0434\u043D\u044B\u0439 \u043A\u043E\u0434/g, 'Open source'],
        [/\u0411\u0435\u0437 \u0442\u0435\u043B\u0435\u0444\u043E\u043D\u0430 \u0438 \u044D\u043B\. \u043F\u043E\u0447\u0442\u044B/g, 'No phone number or email'],
        [/\u0420\u0435\u0434\u0430\u043A\u0442\u0438\u0440\u043E\u0432\u0430\u0442\u044C \u0433\u0440\u0443\u043F\u043F\u0443/g, 'Edit group'],
        [/\u0418\u043D\u0444\u043E\u0440\u043C\u0430\u0446\u0438\u044F \u043E \u0433\u0440\u0443\u043F\u043F\u0435/g, 'Group info'],
        [/\u0421\u043A\u0432\u043E\u0437\u043D\u043E\u0435 \u0448\u0438\u0444\u0440\u043E\u0432\u0430\u043D\u0438\u0435/g, 'End-to-end encrypted'],
        [/\u041D\u0430\u0436\u043C\u0438\u0442\u0435 Enter \u0434\u043B\u044F \u0441\u043E\u0445\u0440\u0430\u043D\u0435\u043D\u0438\u044F, Esc \u0434\u043B\u044F \u043E\u0442\u043C\u0435\u043D\u044B/g, 'Press Enter to save, Esc to cancel'],
        [/\u041A\u0430\u0436\u0434\u043E\u0435 \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u0435 \u0437\u0430\u0449\u0438\u0449\u0435\u043D\u043E \u0441\u043A\u0432\u043E\u0437\u043D\u044B\u043C \u0448\u0438\u0444\u0440\u043E\u0432\u0430\u043D\u0438\u0435\u043C\./g, 'Every message is protected with end-to-end encryption.'],
        [/\u041F\u043E\u0434\u0442\u0432\u0435\u0440\u0434\u0438\u0442\u0435 \u0438\u0437\u043C\u0435\u043D\u0435\u043D\u0438\u044F \u0438\u043B\u0438 \u043E\u0442\u043C\u0435\u043D\u0438\u0442\u0435 \u0440\u0435\u0434\u0430\u043A\u0442\u0438\u0440\u043E\u0432\u0430\u043D\u0438\u0435/g, 'Confirm changes or cancel editing'],
        [/\u041C\u0430\u0441\u0448\u0442\u0430\u0431/g, 'Zoom'],
        [/\u041F\u0440\u0435\u0434\u043F\u0440\u043E\u0441\u043C\u043E\u0442\u0440/g, 'Preview'],
        [/\u041F\u0440\u0435\u0434\u044B\u0434\u0443\u0449\u0435\u0435 \u0438\u0437\u043E\u0431\u0440\u0430\u0436\u0435\u043D\u0438\u0435/g, 'Previous image'],
        [/\u0412\u043E\u0441\u043F\u0440\u043E\u0438\u0437\u0432\u0435\u0441\u0442\u0438 \u0432\u0438\u0434\u0435\u043E/g, 'Play video'],
        [/\u0412\u043E\u0441\u043F\u0440\u043E\u0438\u0437\u0432\u0435\u0441\u0442\u0438 \u0438\u043B\u0438 \u043F\u043E\u0441\u0442\u0430\u0432\u0438\u0442\u044C \u043D\u0430 \u043F\u0430\u0443\u0437\u0443/g, 'Play or pause'],
        [/\u041F\u0440\u043E\u0433\u0440\u0435\u0441\u0441 \u0432\u0438\u0434\u0435\u043E/g, 'Video progress'],
        [/\u0413\u0440\u043E\u043C\u043A\u043E\u0441\u0442\u044C/g, 'Volume'],
        [/\u041F\u043E\u043B\u043D\u043E\u044D\u043A\u0440\u0430\u043D\u043D\u044B\u0439 \u0440\u0435\u0436\u0438\u043C/g, 'Fullscreen'],
        [/\u0421\u043B\u0435\u0434\u0443\u044E\u0449\u0435\u0435 \u0438\u0437\u043E\u0431\u0440\u0430\u0436\u0435\u043D\u0438\u0435/g, 'Next image'],
        [/\u0423\u043C\u0435\u043D\u044C\u0448\u0438\u0442\u044C/g, 'Zoom out'],
        [/\u0423\u0440\u043E\u0432\u0435\u043D\u044C \u043C\u0430\u0441\u0448\u0442\u0430\u0431\u0430/g, 'Zoom level'],
        [/\u0423\u0432\u0435\u043B\u0438\u0447\u0438\u0442\u044C/g, 'Zoom in'],
        [/\u0421\u043E\u0437\u0434\u0430\u0442\u044C \u0433\u0440\u0443\u043F\u043F\u0443/g, 'Create group'],
        [/\u0418\u0437\u043C\u0435\u043D\u0438\u0442\u044C \u0433\u0440\u0443\u043F\u043F\u0443/g, 'Edit group'],
        [/\u041D\u0430\u0437\u0432\u0430\u043D\u0438\u0435 \u0433\u0440\u0443\u043F\u043F\u044B/g, 'Group name'],
        [/\u041A\u043E\u043C\u0430\u043D\u0434\u0430, \u0441\u0435\u043C\u044C\u044F, \u043F\u0440\u043E\u0435\u043A\u0442\.\.\./g, 'Team, family, project...'],
        [/\u0414\u043E\u0431\u0430\u0432\u0438\u0442\u044C \u0443\u0447\u0430\u0441\u0442\u043D\u0438\u043A\u043E\u0432/g, 'Add members'],
        [/\u0412\u0432\u0435\u0434\u0438\u0442\u0435 \u0438\u043C\u044F \u0438\u043B\u0438 @username/g, 'Type name or @username'],
        [/\u0421\u043C\u0435\u043D\u0438\u0442\u044C \u0444\u043E\u0442\u043E/g, 'Change photo'],
        [/\u041E\u0431\u043D\u043E\u0432\u0438\u0442\u0435 \u043D\u0430\u0437\u0432\u0430\u043D\u0438\u0435\.\.\./g, 'Update title...'],
        [/\u041E\u043F\u0438\u0441\u0430\u043D\u0438\u0435 \u0433\u0440\u0443\u043F\u043F\u044B/g, 'Group description'],
        [/\u0410\u0434\u043C\u0438\u043D\u0438\u0441\u0442\u0440\u0430\u0442\u043E\u0440\u044B/g, 'Administrators'],
        [/\u0426\u0435\u043B\u044C \u0436\u0430\u043B\u043E\u0431\u044B: \u043F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u044C \u0438\u043B\u0438 \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u0435 \u043D\u0435 \u0432\u044B\u0431\u0440\u0430\u043D\u044B\./g, 'Report target: user or message is not selected.'],
        [/\u041F\u0440\u0438\u0447\u0438\u043D\u0430/g, 'Reason'],
        [/\u0421\u043F\u0430\u043C/g, 'Spam'],
        [/\u041E\u0441\u043A\u043E\u0440\u0431\u043B\u0435\u043D\u0438\u044F/g, 'Abuse'],
        [/\u041C\u043E\u0448\u0435\u043D\u043D\u0438\u0447\u0435\u0441\u0442\u0432\u043E/g, 'Scam'],
        [/\u041F\u0440\u0435\u0441\u043B\u0435\u0434\u043E\u0432\u0430\u043D\u0438\u0435/g, 'Harassment'],
        [/\u041D\u0430\u0441\u0438\u043B\u0438\u0435/g, 'Violence'],
        [/\u0421\u0435\u043A\u0441\u0443\u0430\u043B\u044C\u043D\u044B\u0439 \u043A\u043E\u043D\u0442\u0435\u043D\u0442/g, 'Sexual content'],
        [/\u041D\u0435\u0437\u0430\u043A\u043E\u043D\u043D\u044B\u0439 \u043A\u043E\u043D\u0442\u0435\u043D\u0442/g, 'Illegal content'],
        [/\u0414\u0440\u0443\u0433\u043E\u0435/g, 'Other'],
        [/\u041A\u043E\u043C\u043C\u0435\u043D\u0442\u0430\u0440\u0438\u0439 \(\u043D\u0435\u043E\u0431\u044F\u0437\u0430\u0442\u0435\u043B\u044C\u043D\u043E\)/g, 'Comment (optional)'],
        [/\u0414\u043E\u0431\u0430\u0432\u044C\u0442\u0435 \u0434\u0435\u0442\u0430\u043B\u0438 \u0434\u043B\u044F \u043C\u043E\u0434\u0435\u0440\u0430\u0442\u043E\u0440\u043E\u0432/g, 'Add details for moderators'],
        [/\u041E\u0442\u043F\u0440\u0430\u0432\u0438\u0442\u044C \u0436\u0430\u043B\u043E\u0431\u0443/g, 'Submit report'],
        [/\u041F\u043E\u0434\u0442\u0432\u0435\u0440\u0434\u0438\u0442\u044C/g, 'Confirm'],
        [/QR-\u043A\u043E\u0434 \u043E\u0442\u0441\u043A\u0430\u043D\u0438\u0440\u043E\u0432\u0430\u043D/g, 'QR code scanned'],
        [/\u0421\u0418\u041D\u0425/g, 'SYNC'],
        [/\u0440\u0430\u0431\u043E\u0442\u0430\u0435\u0442 \u043D\u0430/g, 'powered by'],
        [/\u0427\u0435\u0440\u043D\u043E\u0432\u0438\u043A:/g, 'Draft:'],
        [/\u0420\u0430\u0441\u0448\u0438\u0444\u0440\u043E\u0432\u043A\u0430 \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u044F/g, 'Decrypting message'],
        [/\u0421\u043E\u0437\u0434\u0430\u043D\u0438\u0435\.\.\./g, 'Creating...'],
        [/\u0423\u0447\u0430\u0441\u0442\u043D\u0438\u043A\u0438 \u043F\u043E\u043A\u0430 \u043D\u0435 \u0432\u044B\u0431\u0440\u0430\u043D\u044B\./g, 'No members selected yet.'],
        [/\u0423\u0434\u0430\u043B\u0438\u0442\u044C \u0443\u0447\u0430\u0441\u0442\u043D\u0438\u043A\u0430/g, 'Remove member'],
        [/\u041F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u0438 \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u044B\./g, 'No users found.'],
        [/\u043D\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043D\u043E/g, 'unknown'],
        [/\u0412\u0432\u0435\u0434\u0438\u0442\u0435 \u043C\u0438\u043D\u0438\u043C\u0443\u043C 3 \u0441\u0438\u043C\u0432\u043E\u043B\u0430\./g, 'Type at least 3 characters.'],
        [/\u041F\u043E\u0438\u0441\u043A \u043D\u0435 \u0443\u0434\u0430\u043B\u0441\u044F\. \u041F\u043E\u043F\u0440\u043E\u0431\u0443\u0439\u0442\u0435 \u0441\u043D\u043E\u0432\u0430\./g, 'Search failed. Try again.'],
        [/\u041F\u043E\u0438\u0441\u043A \u043D\u0435 \u0443\u0434\u0430\u043B\u0441\u044F\./g, 'Search failed.'],
        [/\u041D\u0430\u0437\u043D\u0430\u0447\u0438\u0442\u044C \u043C\u043E\u0434\u0435\u0440\u0430\u0442\u043E\u0440\u043E\u043C/g, 'Set moderator'],
        [/\u0421\u0434\u0435\u043B\u0430\u0442\u044C \u0443\u0447\u0430\u0441\u0442\u043D\u0438\u043A\u043E\u043C/g, 'Set member'],
        [/\u0421\u043D\u044F\u0442\u044C \u0430\u0434\u043C\u0438\u043D\u0438\u0441\u0442\u0440\u0430\u0442\u043E\u0440\u0430/g, 'Revoke admin'],
        [/\u041F\u0435\u0440\u0435\u0434\u0430\u0442\u044C \u0432\u043B\u0430\u0434\u0435\u043B\u044C\u0446\u0430/g, 'Transfer owner'],
        [/\u041D\u0430\u0437\u043D\u0430\u0447\u0438\u0442\u044C \u0430\u0434\u043C\u0438\u043D\u0438\u0441\u0442\u0440\u0430\u0442\u043E\u0440\u043E\u043C/g, 'Set admin'],
        [/\u041C\u0443\u0442 \u043D\u0430 1 \u0447/g, 'Mute 1h'],
        [/\u0411\u0430\u043D \u043D\u0430 24 \u0447/g, 'Ban 24h'],
        [/\u041E\u0431\u0436\u0430\u043B\u043E\u0432\u0430\u0442\u044C/g, 'Appeal'],
        [/\u0410\u043F\u0435\u043B\u043B\u044F\u0446\u0438\u044F \u043E\u0436\u0438\u0434\u0430\u0435\u0442 \u0440\u0430\u0441\u0441\u043C\u043E\u0442\u0440\u0435\u043D\u0438\u044F\./g, 'Appeal is pending review.'],
        [/\u041F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u044C (\d+)/g, 'User $1'],
        [/\u0412\u0430\u0448 @/g, 'Your @'],
        [/QR \u0441\u043E\u0434\u0435\u0440\u0436\u0438\u0442 \u043F\u043E\u043B\u043D\u044B\u0439 \u043F\u0443\u0431\u043B\u0438\u0447\u043D\u044B\u0439 \u043A\u043B\u044E\u0447/g, 'QR contains the full public key'],
        [/\u041F\u0440\u0438\u0432\u0430\u0442\u043D\u044B\u0439 \u043A\u043B\u044E\u0447 \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D/g, 'Private key not found'],
        [/\u0412\u044B\u0431\u0440\u0430\u043D\u043E:/g, 'Selected:'],
        [/\u041D\u0430\u0439\u0434\u0435\u043D\u043E:/g, 'Found:'],
        [/\u041F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u044C \u00ab/g, 'User "'],
        [/\u00bb \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D/g, '" not found'],
        [/\u041E\u0442\u043F\u0440\u0430\u0432\u0438\u0442\u044C \u0437\u0430\u043F\u0440\u043E\u0441 \u043F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u044E (.+)\?/g, 'Send request to $1?'],
        [/\u041C\u043E\u0436\u043D\u043E \u0437\u0430\u043A\u0440\u0435\u043F\u0438\u0442\u044C \u043D\u0435 \u0431\u043E\u043B\u0435\u0435 (.+?) \u0447\u0430\u0442\u043E\u0432\.?/g, 'You can pin up to $1 chats.'],
        [/\u041C\u0430\u043A\u0441\u0438\u043C\u0443\u043C (.+?) \u0437\u0430\u043A\u0440\u0435\u043F\u043B\u0451\u043D\u043D\u044B\u0445 \u0447\u0430\u0442\u043E\u0432/g, 'Up to $1 pinned chats'],
        [/\u0417\u0430\u043A\u0440\u0435\u043F\u043B\u0451\u043D\u043D\u044B\u0435 \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u044F (.+)/g, 'Pinned messages $1'],
        [/\u0423\u0434\u0430\u043B\u0438\u0442\u044C (.+?) \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u044F\?/g, 'Delete $1 messages?'],
        [/\u0424\u0430\u0439\u043B "([^"]+)" \u0441\u043B\u0438\u0448\u043A\u043E\u043C \u0431\u043E\u043B\u044C\u0448\u043E\u0439\. \u041C\u0430\u043A\u0441\. (.+?) \u041C\u0411\./g, 'File "$1" is too large. Max $2 MB.'],
        [/\u0424\u0430\u0439\u043B \u0441\u043B\u0438\u0448\u043A\u043E\u043C \u0431\u043E\u043B\u044C\u0448\u043E\u0439\. \u041C\u0430\u043A\u0441\u0438\u043C\u0443\u043C (.+?) \u041C\u0411\./g, 'File is too large. Maximum $1 MB.'],
        [/\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u043F\u043E\u043B\u0443\u0447\u0438\u0442\u044C \u0434\u0430\u043D\u043D\u044B\u0435 \u0430\u043A\u043A\u0430\u0443\u043D\u0442\u0430 \((.+?)\)/g, 'Failed to load account data ($1)'],
        [/\u0420\u0430\u0437\u0434\u0435\u043B \u00ab(.+?)\u00bb \u0431\u0443\u0434\u0435\u0442 \u0434\u043E\u0441\u0442\u0443\u043F\u0435\u043D \u0432 \u0441\u043B\u0435\u0434\u0443\u044E\u0449\u0435\u043C \u043E\u0431\u043D\u043E\u0432\u043B\u0435\u043D\u0438\u0438\./g, 'The "$1" section will be available in the next update.'],
        [/\u041A\u043E\u043D\u0442\u0430\u043A\u0442 \u0432 SUN Messenger:/g, 'SUN Messenger contact:'],
        [/\u041E\u0448\u0438\u0431\u043A\u0430 \u043F\u0440\u0438 \u0441\u043E\u0445\u0440\u0430\u043D\u0435\u043D\u0438\u0438 \u043D\u0430\u0441\u0442\u0440\u043E\u0435\u043A:/g, 'Error saving settings:'],
        [/\u041F\u043E\u043B\u0435 "(.+?)" \u0434\u043E\u043B\u0436\u043D\u043E \u0431\u044B\u0442\u044C true\/false\./g, 'Field "$1" must be true/false.'],
        [/\u0420\u0435\u0430\u043A\u0446\u0438\u044F (.+)/g, 'Reaction $1'],
        [/\u042D\u043C\u043E\u0434\u0437\u0438 (.+)/g, 'Emoji $1'],
        [/\u0427\u0430\u0442 \u0441 /g, 'Chat with '],
        [/\u042D\u043A\u0441\u043F\u043E\u0440\u0442\u0438\u0440\u043E\u0432\u0430\u043D\u043E:/g, 'Exported:'],
        [/\u041D\u043E\u0432\u043E\u0435 \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u0435/g, 'New message'],
        [/\u041D\u043E\u0432\u044B\u0445 \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u0439/g, 'New messages'],
        [/\u041E\u0448\u0438\u0431\u043A\u0430:/g, 'Error:'],
        [/\u041E\u0448\u0438\u0431\u043A\u0430\b/g, 'Error'],
        [/\u0421\u043E\u0445\u0440\u0430\u043D\u0435\u043D\u0438\u0435\u2026/g, 'Saving\u2026'],
        [/\u0421\u043E\u0445\u0440\u0430\u043D\u0438\u0442\u044C/g, 'Save'],
        [/\u041F\u0440\u043E\u0444\u0438\u043B\u044C/g, 'Profile'],
        [/\u041F\u0440\u0438\u0432\u0430\u0442\u043D\u043E\u0441\u0442\u044C/g, 'Privacy'],
        [/\u0411\u0435\u0437\u043E\u043F\u0430\u0441\u043D\u043E\u0441\u0442\u044C/g, 'Security'],
        [/\u0423\u0432\u0435\u0434\u043E\u043C\u043B\u0435\u043D\u0438\u044F/g, 'Notifications'],
        [/\u0412\u043D\u0435\u0448\u043D\u0438\u0439 \u0432\u0438\u0434/g, 'Appearance'],
        [/\u041E\u0431\u043E\u0438/g, 'Wallpaper'],
        [/\u0423\u0441\u0442\u0440\u043E\u0439\u0441\u0442\u0432\u0430/g, 'Devices'],
        [/\u0412\u043A\u043B\u044E\u0447\u0438\u0442\u044C/g, 'Enable'],
        [/\u041E\u0442\u043A\u043B\u044E\u0447\u0438\u0442\u044C/g, 'Disable'],
        [/\u041F\u0440\u043E\u0432\u0435\u0440\u043A\u0430\.\.\./g, 'Checking...'],
        [/\u041F\u043E\u0438\u0441\u043A \u043D\u0430\u0441\u0442\u0440\u043E\u0435\u043A/g, 'Search settings'],
        [/Push-\u0443\u0432\u0435\u0434\u043E\u043C\u043B\u0435\u043D\u0438\u044F/g, 'Push notifications'],
        [/\u0420\u0430\u0437\u0440\u0435\u0448\u0435\u043D\u0438\u0435 \u0431\u0440\u0430\u0443\u0437\u0435\u0440\u0430/g, 'Browser permission'],
        [/\u041F\u043E\u0434\u043F\u0438\u0441\u043A\u0430 \u043D\u0430 push/g, 'Push subscription'],
        [/\u0414\u0435\u0439\u0441\u0442\u0432\u0438\u044F/g, 'Actions'],
        [/\u0412\u043A\u043B\u044E\u0447\u0438\u0442\u0435 \u0438\u043B\u0438 \u043E\u0442\u043A\u043B\u044E\u0447\u0438\u0442\u0435 push \u0434\u043B\u044F \u044D\u0442\u043E\u0433\u043E \u0431\u0440\u0430\u0443\u0437\u0435\u0440\u0430\./g, 'Enable or disable push for this browser.'],
        [/\u041E\u0442\u043A\u043B\u044E\u0447\u0435\u043D\u043E \u043D\u0430 \u0441\u0435\u0440\u0432\u0435\u0440\u0435/g, 'Disabled by server'],
        [/\u041D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u043D\u043E \u0432 \u044D\u0442\u043E\u043C \u0431\u0440\u0430\u0443\u0437\u0435\u0440\u0435 \u0438\u043B\u0438 \u0432 \u043D\u0435\u0431\u0435\u0437\u043E\u043F\u0430\u0441\u043D\u043E\u043C \u043A\u043E\u043D\u0442\u0435\u043A\u0441\u0442\u0435\./g, 'Unsupported in this browser or insecure context.'],
        [/\u041D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u043D\u043E/g, 'Unavailable'],
        [/\u041F\u043E\u0434\u043F\u0438\u0441\u043A\u0430 \u0430\u043A\u0442\u0438\u0432\u043D\u0430/g, 'Subscribed'],
        [/\u041F\u043E\u0434\u043F\u0438\u0441\u043A\u0430 \u043D\u0435 \u0430\u043A\u0442\u0438\u0432\u043D\u0430/g, 'Not subscribed'],
        [/Push \u043D\u0435 \u043F\u043E\u0434\u0434\u0435\u0440\u0436\u0438\u0432\u0430\u0435\u0442\u0441\u044F \u0432 \u044D\u0442\u043E\u043C \u0431\u0440\u0430\u0443\u0437\u0435\u0440\u0435\./g, 'Push is not supported in this browser.'],
        [/Push \u043E\u0442\u043A\u043B\u044E\u0447\u0435\u043D \u043D\u0430 \u0441\u0442\u043E\u0440\u043E\u043D\u0435 \u0441\u0435\u0440\u0432\u0435\u0440\u0430\./g, 'Push is disabled on server side.'],
        [/\u0420\u0430\u0437\u0440\u0435\u0448\u0435\u043D\u0438\u0435 \u043D\u0430 \u0443\u0432\u0435\u0434\u043E\u043C\u043B\u0435\u043D\u0438\u044F \u043D\u0435 \u0432\u044B\u0434\u0430\u043D\u043E\./g, 'Notification permission was not granted.'],
        [/Push-\u0443\u0432\u0435\u0434\u043E\u043C\u043B\u0435\u043D\u0438\u044F \u0432\u043A\u043B\u044E\u0447\u0435\u043D\u044B\./g, 'Push notifications enabled.'],
        [/Push-\u0443\u0432\u0435\u0434\u043E\u043C\u043B\u0435\u043D\u0438\u044F \u043E\u0442\u043A\u043B\u044E\u0447\u0435\u043D\u044B\./g, 'Push notifications disabled.'],
        [/\u0420\u0435\u0437\u0435\u0440\u0432\u043D\u0430\u044F \u043A\u043E\u043F\u0438\u044F \u043D\u0430\u0441\u0442\u0440\u043E\u0435\u043A/g, 'Settings backup'],
        [/\u042D\u043A\u0441\u043F\u043E\u0440\u0442 \/ \u0438\u043C\u043F\u043E\u0440\u0442/g, 'Export / import'],
        [/\u041F\u0435\u0440\u0435\u043D\u043E\u0441 \u043F\u0435\u0440\u0441\u043E\u043D\u0430\u043B\u0438\u0437\u0430\u0446\u0438\u0438 \u0438 \u043F\u0440\u0438\u0432\u0430\u0442\u043D\u043E\u0441\u0442\u0438 \u043C\u0435\u0436\u0434\u0443 \u0443\u0441\u0442\u0440\u043E\u0439\u0441\u0442\u0432\u0430\u043C\u0438\./g, 'Transfer personalization and privacy settings between devices.'],
        [/\u042D\u043A\u0441\u043F\u043E\u0440\u0442 JSON/g, 'Export JSON'],
        [/\u0418\u043C\u043F\u043E\u0440\u0442 JSON/g, 'Import JSON'],
        [/\u041D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0438 \u044D\u043A\u0441\u043F\u043E\u0440\u0442\u0438\u0440\u043E\u0432\u0430\u043D\u044B\./g, 'Settings exported.'],
        [/\u041D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0438 \u0438\u043C\u043F\u043E\u0440\u0442\u0438\u0440\u043E\u0432\u0430\u043D\u044B\. \u041F\u0435\u0440\u0435\u0437\u0430\u0433\u0440\u0443\u0436\u0430\u0435\u043C \u0438\u043D\u0442\u0435\u0440\u0444\u0435\u0439\u0441\.\.\./g, 'Settings imported. Reloading UI...'],
        [/\u041D\u0435\u043A\u043E\u0440\u0440\u0435\u043A\u0442\u043D\u044B\u0439 \u0444\u0430\u0439\u043B \u043D\u0430\u0441\u0442\u0440\u043E\u0435\u043A: \u043E\u0442\u0441\u0443\u0442\u0441\u0442\u0432\u0443\u0435\u0442 serverSettings\./g, 'Invalid settings file: missing serverSettings.'],
        [/\u0412\u044B\u0439\u0442\u0438 \u0438\u0437 \u0441\u0438\u0441\u0442\u0435\u043C\u044B/g, 'Sign out'],
        [/\u0421\u0435\u0442\u0435\u0432\u0430\u044F \u043E\u0448\u0438\u0431\u043A\u0430/g, 'Network error'],
        [/\u0412\u0438\u0434\u043D\u043E \u0441\u043E\u0431\u0435\u0441\u0435\u0434\u043D\u0438\u043A\u0430\u043C \u0432 \u0432\u0430\u0448\u0435\u043C \u043F\u0440\u043E\u0444\u0438\u043B\u0435\./g, 'Visible to your contacts in your profile.'],
    ];

    const SKIP_TRANSLATION_SELECTOR = [
        '#messagesContainer',
        '.message',
        '.message-bubble',
        '.chat-message',
        '.contact-last-msg',
        '.contact-name',
        '.settings-avatar-name',
        '.sidebar-bottom-name',
        '[data-no-i18n="1"]',
        '.sun-no-i18n',
    ].join(',');

    function normalizeLanguage(raw, fallback) {
        const value = String(raw || '').trim().toLowerCase();
        if (SUPPORTED_LANGUAGES.has(value)) {
            return value;
        }
        const normalizedFallback = String(fallback || '').trim().toLowerCase();
        if (SUPPORTED_LANGUAGES.has(normalizedFallback)) {
            return normalizedFallback;
        }
        return 'ru';
    }

    function detectInitialLanguage() {
        const fromStorageRaw = String(localStorage.getItem(STORAGE_KEY) || '').trim().toLowerCase();
        if (SUPPORTED_LANGUAGES.has(fromStorageRaw)) {
            return fromStorageRaw;
        }

        const fromServerRaw = String(
            document.body?.dataset?.uiLanguage || document.documentElement?.getAttribute('lang') || '',
        ).trim().toLowerCase();
        if (SUPPORTED_LANGUAGES.has(fromServerRaw)) {
            return fromServerRaw;
        }

        const browserLang = String(navigator.language || '').trim().toLowerCase();
        if (browserLang.startsWith('en')) {
            return 'en';
        }
        if (browserLang.startsWith('ru')) {
            return 'ru';
        }
        return 'ru';
    }

    function resolveLocalesBaseUrl() {
        const scripts = document.getElementsByTagName('script');
        let runtimeScript = null;
        for (let i = scripts.length - 1; i >= 0; i -= 1) {
            const src = String(scripts[i].getAttribute('src') || '');
            if (!src) continue;
            if (src.includes('i18n-runtime.js') || src.includes('i18n.js')) {
                runtimeScript = scripts[i];
                break;
            }
        }

        try {
            if (runtimeScript && runtimeScript.src) {
                const absolute = new URL(runtimeScript.src, window.location.href);
                const idx = absolute.pathname.indexOf('/static/');
                if (idx >= 0) {
                    return absolute.origin + absolute.pathname.slice(0, idx + '/static/'.length) + 'locales/';
                }
            }
        } catch (_err) {}

        return '/static/locales/';
    }

    function getLocaleUrl(language) {
        const lang = normalizeLanguage(language, 'ru');
        return resolveLocalesBaseUrl() + lang + '.json';
    }

    async function loadLocale(language) {
        const lang = normalizeLanguage(language, 'ru');
        if (LOCALE_MAPS[lang]) {
            return LOCALE_MAPS[lang];
        }
        if (LOCALE_LOADERS.has(lang)) {
            return LOCALE_LOADERS.get(lang);
        }

        const loader = fetch(getLocaleUrl(lang), { credentials: 'same-origin' })
            .then((response) => (response.ok ? response.json() : {}))
            .then((payload) => {
                const map = payload && typeof payload === 'object' ? payload : {};
                LOCALE_MAPS[lang] = map;
                return map;
            })
            .catch(() => {
                LOCALE_MAPS[lang] = {};
                return {};
            })
            .finally(() => {
                LOCALE_LOADERS.delete(lang);
            });

        LOCALE_LOADERS.set(lang, loader);
        return loader;
    }

    function translateTextToEnglish(sourceText) {
        let text = String(sourceText ?? '');
        if (!text) {
            return text;
        }

        const map = LOCALE_MAPS.en || {};
        const exact = map[text];
        if (typeof exact === 'string') {
            return exact;
        }
        const trimmed = text.trim();
        if (trimmed && trimmed !== text) {
            const trimmedExact = map[trimmed];
            if (typeof trimmedExact === 'string') {
                const leading = text.match(/^\s*/)?.[0] || '';
                const trailing = text.match(/\s*$/)?.[0] || '';
                return leading + trimmedExact + trailing;
            }
        }

        for (const [pattern, replacement] of PHRASE_REPLACEMENTS_EN) {
            text = text.replace(pattern, replacement);
        }

        return text;
    }

    function translateText(sourceText, language) {
        const lang = normalizeLanguage(language, 'ru');
        if (lang !== 'en') {
            return String(sourceText ?? '');
        }
        return translateTextToEnglish(sourceText);
    }

    function shouldSkipElement(element) {
        if (!element || element.nodeType !== Node.ELEMENT_NODE) {
            return false;
        }
        return Boolean(element.closest(SKIP_TRANSLATION_SELECTOR));
    }

    function applyTextNode(node, language) {
        if (!node || node.nodeType !== Node.TEXT_NODE) {
            return;
        }
        const parentElement = node.parentElement;
        if (!parentElement) {
            return;
        }
        const tag = parentElement.tagName;
        if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'TEXTAREA') {
            return;
        }
        if (shouldSkipElement(parentElement)) {
            return;
        }
        if (typeof node.__sunI18nOriginalText === 'undefined') {
            node.__sunI18nOriginalText = node.nodeValue;
        }
        const original = node.__sunI18nOriginalText;
        const translated = translateText(original, language);
        if (translated !== node.nodeValue) {
            node.nodeValue = translated;
        }
    }

    function applyElementAttributes(element, language) {
        if (!element || element.nodeType !== Node.ELEMENT_NODE) {
            return;
        }
        if (shouldSkipElement(element)) {
            return;
        }
        const attributes = ['placeholder', 'title', 'aria-label', 'alt'];
        if (
            element.tagName === 'INPUT'
            && ['button', 'submit', 'reset'].includes(String(element.getAttribute('type') || '').toLowerCase())
        ) {
            attributes.push('value');
        }
        for (const attributeName of attributes) {
            if (!element.hasAttribute(attributeName)) {
                continue;
            }
            const storageKey = '__sunI18nOriginalAttr_' + attributeName;
            if (typeof element[storageKey] === 'undefined') {
                element[storageKey] = element.getAttribute(attributeName);
            }
            const original = element[storageKey];
            const translated = translateText(original, language);
            if (translated !== element.getAttribute(attributeName)) {
                element.setAttribute(attributeName, translated);
            }
        }
    }

    function applyTranslations(root, language) {
        const lang = normalizeLanguage(language, 'ru');
        const targetRoot = root && root.nodeType ? root : document.body;
        if (!targetRoot) {
            return;
        }

        if (targetRoot.nodeType === Node.TEXT_NODE) {
            applyTextNode(targetRoot, lang);
            return;
        }

        if (targetRoot.nodeType === Node.ELEMENT_NODE) {
            applyElementAttributes(targetRoot, lang);
        }

        const walker = document.createTreeWalker(targetRoot, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
            applyTextNode(walker.currentNode, lang);
        }

        if (targetRoot.querySelectorAll) {
            const elements = targetRoot.querySelectorAll('*');
            for (const element of elements) {
                applyElementAttributes(element, lang);
            }
        }
    }

    let currentLanguage = detectInitialLanguage();
    let languageChangeSeq = 0;

    function setLanguage(language, options) {
        const opts = options || {};
        const previousLanguage = currentLanguage;
        const changeSeq = ++languageChangeSeq;
        currentLanguage = normalizeLanguage(language, currentLanguage);
        document.documentElement.setAttribute('lang', currentLanguage);
        if (document.body) {
            document.body.dataset.uiLanguage = currentLanguage;
        }
        if (opts.persist !== false) {
            localStorage.setItem(STORAGE_KEY, currentLanguage);
        }
        if (opts.apply !== false) {
            applyTranslations(document.body || document.documentElement, currentLanguage);
        }
        if (currentLanguage === 'en') {
            void loadLocale('en').then(() => {
                if (currentLanguage !== 'en') return;
                if (opts.apply !== false) {
                    applyTranslations(document.body || document.documentElement, 'en');
                }
                if (previousLanguage !== currentLanguage && changeSeq === languageChangeSeq) {
                    window.dispatchEvent(
                        new CustomEvent('sun-ui-language-changed', {
                            detail: {
                                language: currentLanguage,
                                previous_language: previousLanguage,
                                hydrated: true,
                            },
                        }),
                    );
                }
            });
        }
        if (previousLanguage !== currentLanguage) {
            window.dispatchEvent(
                new CustomEvent('sun-ui-language-changed', {
                    detail: {
                        language: currentLanguage,
                        previous_language: previousLanguage,
                        hydrated: false,
                    },
                }),
            );
        }
        return currentLanguage;
    }

    function getLanguage() {
        return currentLanguage;
    }

    const api = {
        getLanguage,
        setLanguage,
        translateText: (text) => translateText(text, currentLanguage),
        applyTranslations: (root) => applyTranslations(root || document.body, currentLanguage),
    };
    window.SUN_I18N = api;

    const bootstrap = () => {
        void loadLocale('ru');
        void loadLocale('en');
        setLanguage(currentLanguage, { persist: true, apply: true });

        if (!window.__sunI18nDialogsPatched) {
            const nativeAlert = window.alert ? window.alert.bind(window) : null;
            const nativeConfirm = window.confirm ? window.confirm.bind(window) : null;
            const nativePrompt = window.prompt ? window.prompt.bind(window) : null;
            if (nativeAlert) {
                window.alert = (message) => nativeAlert(translateText(message, currentLanguage));
            }
            if (nativeConfirm) {
                window.confirm = (message) => nativeConfirm(translateText(message, currentLanguage));
            }
            if (nativePrompt) {
                window.prompt = (message, defaultValue) => nativePrompt(
                    translateText(message, currentLanguage),
                    defaultValue,
                );
            }
            window.__sunI18nDialogsPatched = true;
        }

        const observer = new MutationObserver((mutations) => {
            if (currentLanguage !== 'en') {
                return;
            }
            for (const mutation of mutations) {
                mutation.addedNodes.forEach((node) => {
                    applyTranslations(node, currentLanguage);
                });
                if (mutation.type === 'characterData') {
                    applyTextNode(mutation.target, currentLanguage);
                }
                if (mutation.type === 'attributes' && mutation.target?.nodeType === Node.ELEMENT_NODE) {
                    applyElementAttributes(mutation.target, currentLanguage);
                }
            }
        });

        const observerOptions = {
            childList: true,
            subtree: true,
            characterData: true,
            attributes: true,
            attributeFilter: ['title', 'placeholder', 'aria-label', 'value'],
        };
        const observerRoot = document.body || document.documentElement;
        if (observerRoot) {
            observer.observe(observerRoot, observerOptions);
        }
        if (!document.body) {
            document.addEventListener('DOMContentLoaded', () => {
                if (!document.body) return;
                try { observer.disconnect(); } catch (_) {}
                observer.observe(document.body, observerOptions);
                applyTranslations(document.body, currentLanguage);
            }, { once: true });
        }

        window.addEventListener('storage', (event) => {
            if (String(event.key || '') !== STORAGE_KEY) return;
            const nextLanguage = normalizeLanguage(event.newValue, currentLanguage);
            if (nextLanguage === currentLanguage) return;
            setLanguage(nextLanguage, { persist: false, apply: true });
        });
    };

    bootstrap();
})();

