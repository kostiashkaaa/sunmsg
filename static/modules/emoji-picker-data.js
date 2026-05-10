export const PICKER_TABS = ['emoji', 'stickers', 'gifs'];

export const EMOJI_CATEGORY_ORDER = [
    'frequent',
    'peoples',
    'nature',
    'food',
    'activity',
    'travel',
    'objects',
    'symbols',
    'flags',
];

export const EMOJI_CATEGORY_META = {
    frequent: {
        icon: '\u{1F557}',
        titleRu: 'Недавние',
        titleEn: 'Recent',
        searchTags: ['недавние', 'частые', 'recent', 'frequent', 'history'],
    },
    peoples: {
        icon: '\u{1F60A}',
        titleRu: 'Смайлы и люди',
        titleEn: 'Smileys & People',
        searchTags: ['люди', 'лица', 'эмоции', 'smile', 'face', 'people'],
    },
    nature: {
        icon: '\u{1F331}',
        titleRu: 'Природа',
        titleEn: 'Nature',
        searchTags: ['природа', 'животные', 'растения', 'nature', 'animals', 'plants'],
    },
    food: {
        icon: '\u{1F34E}',
        titleRu: 'Еда',
        titleEn: 'Food',
        searchTags: ['еда', 'напитки', 'food', 'drink', 'meal'],
    },
    activity: {
        icon: '\u{26BD}',
        titleRu: 'Активность',
        titleEn: 'Activity',
        searchTags: ['спорт', 'игры', 'activity', 'sport', 'games'],
    },
    travel: {
        icon: '\u{1F697}',
        titleRu: 'Путешествия',
        titleEn: 'Travel',
        searchTags: ['путешествия', 'транспорт', 'travel', 'transport', 'places'],
    },
    objects: {
        icon: '\u{1F4A1}',
        titleRu: 'Объекты',
        titleEn: 'Objects',
        searchTags: ['предметы', 'объекты', 'objects', 'things', 'tools'],
    },
    symbols: {
        icon: '\u{2764}\u{FE0F}',
        titleRu: 'Символы',
        titleEn: 'Symbols',
        searchTags: ['символы', 'знаки', 'symbols', 'signs', 'hearts'],
    },
    flags: {
        icon: '\u{1F3C1}',
        titleRu: 'Флаги',
        titleEn: 'Flags',
        searchTags: ['флаги', 'страны', 'flags', 'countries'],
    },
};

export const STICKER_CATEGORY_ORDER = ['recent', 'mood', 'love', 'fun', 'animals'];

export const STICKER_CATEGORY_META = {
    recent: { icon: '\u{1F551}', titleRu: 'Недавние', titleEn: 'Recent' },
    mood: { icon: '\u{1F642}', titleRu: 'Настроение', titleEn: 'Mood' },
    love: { icon: '\u{2764}\u{FE0F}', titleRu: 'Любовь', titleEn: 'Love' },
    fun: { icon: '\u{1F389}', titleRu: 'Фан', titleEn: 'Fun' },
    animals: { icon: '\u{1F63A}', titleRu: 'Животные', titleEn: 'Animals' },
};

export const STICKER_ITEMS = {
    mood: [
        { id: 'stk_smile', emoji: '\u{1F604}', ru: 'Широкая улыбка', en: 'Big smile', keywords: ['улыбка', 'радость', 'smile', 'happy'] },
        { id: 'stk_cool', emoji: '\u{1F60E}', ru: 'Круто', en: 'Cool', keywords: ['круто', 'очки', 'cool', 'style'] },
        { id: 'stk_think', emoji: '\u{1F914}', ru: 'Думаю', en: 'Thinking', keywords: ['думать', 'вопрос', 'think', 'hmm'] },
        { id: 'stk_wink', emoji: '\u{1F609}', ru: 'Подмигивание', en: 'Wink', keywords: ['подмиг', 'wink', 'flirt'] },
        { id: 'stk_sleep', emoji: '\u{1F634}', ru: 'Сон', en: 'Sleepy', keywords: ['сон', 'устал', 'sleepy', 'tired'] },
        { id: 'stk_fire', emoji: '\u{1F525}', ru: 'Огонь', en: 'Fire', keywords: ['огонь', 'fire', 'hot'] },
    ],
    love: [
        { id: 'stk_heart', emoji: '\u{2764}\u{FE0F}', ru: 'Сердце', en: 'Heart', keywords: ['сердце', 'любовь', 'heart', 'love'] },
        { id: 'stk_kiss', emoji: '\u{1F618}', ru: 'Поцелуй', en: 'Kiss', keywords: ['поцелуй', 'kiss', 'romance'] },
        { id: 'stk_hug', emoji: '\u{1F917}', ru: 'Обнимашки', en: 'Hug', keywords: ['обнять', 'hug', 'care'] },
        { id: 'stk_roses', emoji: '\u{1F339}', ru: 'Роза', en: 'Rose', keywords: ['роза', 'цветок', 'rose', 'flower'] },
        { id: 'stk_ring', emoji: '\u{1F48D}', ru: 'Кольцо', en: 'Ring', keywords: ['кольцо', 'proposal', 'ring'] },
        { id: 'stk_sparkle', emoji: '\u{2728}', ru: 'Сияние', en: 'Sparkles', keywords: ['сияние', 'sparkle', 'shine'] },
    ],
    fun: [
        { id: 'stk_party', emoji: '\u{1F973}', ru: 'Праздник', en: 'Party', keywords: ['праздник', 'party', 'celebrate'] },
        { id: 'stk_laugh', emoji: '\u{1F923}', ru: 'Смех', en: 'Rolling laugh', keywords: ['смех', 'laugh', 'lol'] },
        { id: 'stk_rocket', emoji: '\u{1F680}', ru: 'Погнали', en: 'Let’s go', keywords: ['ракета', 'go', 'rocket'] },
        { id: 'stk_boom', emoji: '\u{1F4A5}', ru: 'Бум', en: 'Boom', keywords: ['бум', 'wow', 'boom'] },
        { id: 'stk_ok', emoji: '\u{1F44C}', ru: 'Окей', en: 'OK', keywords: ['ок', 'ok', 'perfect'] },
        { id: 'stk_clap', emoji: '\u{1F44F}', ru: 'Аплодисменты', en: 'Clap', keywords: ['аплодисменты', 'clap', 'bravo'] },
    ],
    animals: [
        { id: 'stk_cat_love', emoji: '\u{1F63B}', ru: 'Кот влюблён', en: 'Cat in love', keywords: ['кот', 'cat', 'love'] },
        { id: 'stk_cat_happy', emoji: '\u{1F63A}', ru: 'Весёлый кот', en: 'Happy cat', keywords: ['кот', 'cat', 'happy'] },
        { id: 'stk_dog', emoji: '\u{1F436}', ru: 'Пёс', en: 'Dog', keywords: ['пёс', 'dog', 'pet'] },
        { id: 'stk_fox', emoji: '\u{1F98A}', ru: 'Лис', en: 'Fox', keywords: ['лис', 'fox'] },
        { id: 'stk_panda', emoji: '\u{1F43C}', ru: 'Панда', en: 'Panda', keywords: ['панда', 'panda'] },
        { id: 'stk_unicorn', emoji: '\u{1F984}', ru: 'Единорог', en: 'Unicorn', keywords: ['единорог', 'unicorn', 'magic'] },
    ],
};

export const GIF_CATEGORY_ORDER = ['recent', 'reactions', 'happy', 'wow', 'mood'];

export const GIF_CATEGORY_META = {
    recent: { icon: '\u{1F551}', titleRu: 'Недавние', titleEn: 'Recent' },
    reactions: { icon: '\u{1F44D}', titleRu: 'Реакции', titleEn: 'Reactions' },
    happy: { icon: '\u{1F602}', titleRu: 'Веселье', titleEn: 'Happy' },
    wow: { icon: '\u{1F62E}', titleRu: 'Вау', titleEn: 'Wow' },
    mood: { icon: '\u{1F60E}', titleRu: 'Муд', titleEn: 'Mood' },
};

export const GIF_ITEMS = {
    reactions: [
        { id: 'gif_applause', emoji: '\u{1F44F}', ru: 'Аплодисменты', en: 'Applause', keywords: ['аплодисменты', 'clap', 'bravo'], color: 'var(--accent-soft)' },
        { id: 'gif_thumbsup', emoji: '\u{1F44D}', ru: 'Лайк', en: 'Thumbs up', keywords: ['лайк', 'like', 'ok'], color: 'color-mix(in srgb, var(--accent) 24%, transparent)' },
        { id: 'gif_facepalm', emoji: '\u{1F926}', ru: 'Фейспалм', en: 'Facepalm', keywords: ['фейспалм', 'facepalm'], color: 'color-mix(in srgb, #f59e0b 24%, transparent)' },
        { id: 'gif_nope', emoji: '\u{274C}', ru: 'Нет', en: 'Nope', keywords: ['нет', 'no', 'reject'], color: 'color-mix(in srgb, #ef4444 24%, transparent)' },
        { id: 'gif_yes', emoji: '\u{2705}', ru: 'Да', en: 'Yes', keywords: ['да', 'yes', 'approve'], color: 'color-mix(in srgb, #22c55e 22%, transparent)' },
        { id: 'gif_bow', emoji: '\u{1F647}', ru: 'Поклон', en: 'Bow', keywords: ['спасибо', 'поклон', 'thanks'], color: 'color-mix(in srgb, #14b8a6 24%, transparent)' },
    ],
    happy: [
        { id: 'gif_laugh', emoji: '\u{1F923}', ru: 'Смех', en: 'Laugh', keywords: ['смех', 'laugh', 'lol'], color: 'color-mix(in srgb, #fb7185 22%, transparent)' },
        { id: 'gif_party', emoji: '\u{1F973}', ru: 'Туса', en: 'Party', keywords: ['туса', 'party', 'celebrate'], color: 'color-mix(in srgb, #a855f7 20%, transparent)' },
        { id: 'gif_dance', emoji: '\u{1F57A}', ru: 'Танцы', en: 'Dance', keywords: ['танцы', 'dance'], color: 'color-mix(in srgb, #eab308 24%, transparent)' },
        { id: 'gif_hype', emoji: '\u{1F680}', ru: 'Хайп', en: 'Hype', keywords: ['ракета', 'hype', 'rocket'], color: 'color-mix(in srgb, #3b82f6 22%, transparent)' },
        { id: 'gif_win', emoji: '\u{1F3C6}', ru: 'Победа', en: 'Win', keywords: ['победа', 'win', 'champion'], color: 'color-mix(in srgb, #f59e0b 22%, transparent)' },
        { id: 'gif_spark', emoji: '\u{2728}', ru: 'Искры', en: 'Sparkles', keywords: ['искры', 'spark', 'shine'], color: 'color-mix(in srgb, #22d3ee 20%, transparent)' },
    ],
    wow: [
        { id: 'gif_shock', emoji: '\u{1F631}', ru: 'Шок', en: 'Shock', keywords: ['шок', 'shock', 'omg'], color: 'color-mix(in srgb, #ef4444 24%, transparent)' },
        { id: 'gif_wow', emoji: '\u{1F62E}', ru: 'Вау', en: 'Wow', keywords: ['вау', 'wow', 'surprise'], color: 'color-mix(in srgb, #f97316 22%, transparent)' },
        { id: 'gif_eyes', emoji: '\u{1F440}', ru: 'Смотрю', en: 'Watching', keywords: ['смотрю', 'eyes', 'watch'], color: 'color-mix(in srgb, #0ea5e9 22%, transparent)' },
        { id: 'gif_mindblown', emoji: '\u{1F92F}', ru: 'Разрыв', en: 'Mind blown', keywords: ['взорвало', 'mindblown'], color: 'color-mix(in srgb, #8b5cf6 20%, transparent)' },
        { id: 'gif_scream', emoji: '\u{1F62D}', ru: 'Крик', en: 'Scream', keywords: ['крик', 'scream'], color: 'color-mix(in srgb, #ec4899 20%, transparent)' },
        { id: 'gif_confused', emoji: '\u{1F615}', ru: 'Не понял', en: 'Confused', keywords: ['не понял', 'confused'], color: 'color-mix(in srgb, #64748b 24%, transparent)' },
    ],
    mood: [
        { id: 'gif_chill', emoji: '\u{1F60C}', ru: 'Чилл', en: 'Chill', keywords: ['чилл', 'relax', 'calm'], color: 'color-mix(in srgb, #0ea5e9 18%, transparent)' },
        { id: 'gif_coffee', emoji: '\u{2615}', ru: 'Кофе', en: 'Coffee', keywords: ['кофе', 'coffee', 'break'], color: 'color-mix(in srgb, #a16207 20%, transparent)' },
        { id: 'gif_night', emoji: '\u{1F319}', ru: 'Ночь', en: 'Night', keywords: ['ночь', 'night', 'sleep'], color: 'color-mix(in srgb, #312e81 26%, transparent)' },
        { id: 'gif_music', emoji: '\u{1F3A7}', ru: 'Музыка', en: 'Music', keywords: ['музыка', 'music'], color: 'color-mix(in srgb, #14b8a6 20%, transparent)' },
        { id: 'gif_work', emoji: '\u{1F4BB}', ru: 'Работа', en: 'Work mode', keywords: ['работа', 'work', 'focus'], color: 'color-mix(in srgb, #64748b 26%, transparent)' },
        { id: 'gif_zen', emoji: '\u{1F9D8}', ru: 'Дзен', en: 'Zen', keywords: ['дзен', 'zen', 'meditate'], color: 'color-mix(in srgb, #22c55e 16%, transparent)' },
    ],
};

export const PICKER_I18N = {
    ru: {
        tabs: { emoji: 'Эмодзи', stickers: 'Стикеры', gifs: 'GIF' },
        searchPlaceholder: { emoji: 'Поиск эмодзи', stickers: 'Поиск стикеров', gifs: 'Поиск GIF' },
        searchResultsTitle: 'Результаты поиска',
        emptySearch: 'Ничего не найдено',
        emptyRecentEmoji: 'Недавние эмодзи появятся после выбора',
        emptyRecentSticker: 'Недавние стикеры появятся после выбора',
        emptyRecentGif: 'Недавние GIF появятся после выбора',
        stickerHint: 'Стикер',
        gifHint: 'GIF',
        recentTitle: 'Недавние',
        noEmojiData: 'Не удалось загрузить эмодзи',
    },
    en: {
        tabs: { emoji: 'Emoji', stickers: 'Stickers', gifs: 'GIFs' },
        searchPlaceholder: { emoji: 'Search emoji', stickers: 'Search stickers', gifs: 'Search GIFs' },
        searchResultsTitle: 'Search results',
        emptySearch: 'No results found',
        emptyRecentEmoji: 'Recent emojis will appear after selection',
        emptyRecentSticker: 'Recent stickers will appear after selection',
        emptyRecentGif: 'Recent GIFs will appear after selection',
        stickerHint: 'Sticker',
        gifHint: 'GIF',
        recentTitle: 'Recent',
        noEmojiData: 'Failed to load emojis',
    },
};

export function resolvePickerLocale(language) {
    return String(language || '').toLowerCase().startsWith('en') ? 'en' : 'ru';
}
