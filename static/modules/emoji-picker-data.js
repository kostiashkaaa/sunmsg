export const DEFAULT_EMOJI_CATEGORY = 'frequent';

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

export const EMOJI_PICKER_I18N = {
    ru: {
        searchPlaceholder: 'Поиск эмодзи',
        searchResultsTitle: 'Результаты поиска',
        emptySearch: 'Ничего не найдено',
        emptyRecent: 'Недавние эмодзи появятся после выбора',
        noEmojiData: 'Не удалось загрузить эмодзи',
    },
    en: {
        searchPlaceholder: 'Search emoji',
        searchResultsTitle: 'Search results',
        emptySearch: 'No results found',
        emptyRecent: 'Recent emojis will appear after selection',
        noEmojiData: 'Failed to load emojis',
    },
};

export function resolvePickerLocale(language) {
    return String(language || '').toLowerCase().startsWith('en') ? 'en' : 'ru';
}
