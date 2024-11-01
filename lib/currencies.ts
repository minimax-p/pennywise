export const Currencies = [
    {value: 'AUD', label: '$ Dollar', locale: 'en-AU', emoji: '🇦🇺',},
    {value: 'CAD', label: '$ Dollar', locale: 'en-CA', emoji: '🇨🇦',},
    {value: 'CHF', label: 'Fr Franc', locale: 'fr-CH', emoji: '🇨🇭',},
    {value: 'CNY', label: '¥ Yuan', locale: 'zh-CN', emoji: '🇨🇳',},
    {value: 'EUR', label: '€ Euro', locale: 'de-DE', emoji: '🇪🇺',},
    {value: 'GBP', label: '£ Pound', locale: 'en-GB',emoji: '🇬🇧',},
    {value: 'INR', label: '₹ Rupee', locale: 'hi-IN', emoji: '🇮🇳',},
    {value: 'JPY', label: '¥ Yen', locale: 'ja-JP', emoji: '🇯🇵',},
    {value: 'KRW', label: '₩ Won', locale: 'ko-KR', emoji: '🇰🇷',},
    {value: 'MXN', label: '$ Peso', locale: 'es-MX', emoji: '🇲🇽',},
    {value: 'THB', label: '฿ Baht', locale: 'th-TH', emoji: '🇹🇭',},
    {value: 'TWD', label: '$ Dollar', locale: 'zh-TW', emoji: '🇹🇼',},
    {value: 'USD', label: '$ Dollar', locale: 'en-US', emoji: '🇺🇸',},
    {value: 'VND', label: '₫ Đồng', locale: 'vi-VN', emoji: '🇻🇳',},
]

export type Currency = (typeof Currencies)[0]