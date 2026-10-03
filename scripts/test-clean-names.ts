function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&amp;#(\d+);/g, (_, code) => String.fromCodePoint(parseInt(code, 10)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(parseInt(code, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function cleanServiceName(name: string): string {
  let cleaned = decodeHtmlEntities(name);

  // 1. Remove Provider Brands
  const providerRegex = /\b(?:soc[- ]?rocket|vexboost|stream[- ]?promotion|smmprime|smm[- ]?prime|smm[- ]?panel[- ]?us|prosmm[- ]?shop|prosmm)\b/gi;
  cleaned = cleaned.replace(providerRegex, '');

  // 2. Remove Technical IDs and prefixes
  cleaned = cleaned.replace(/^\s*(?:id\s*\d+|\d+\.)\s*/i, '');

  // 3. Remove raw speed/technical tags like [0-1/Ч], [0-15/М], [MQ], [S1]-[S9], [База #1], [Сервер: 1]
  cleaned = cleaned.replace(/\[\s*\d+-\d+\/[ЧМчмHDhd]\s*\]/gi, '');
  cleaned = cleaned.replace(/\[\s*\d+-\d+\s*(?:часов|минут|суток)\s*\]/gi, '');
  cleaned = cleaned.replace(/\[\s*\d+[КkK]?\/[ДдDdHhЧч]\s*\]/gi, '');
  cleaned = cleaned.replace(/\[\s*(?:MQ|S\d+|База\s*#?\d+|Сервер\s*#?:?\s*\d+)\s*\]/gi, '');

  // 4. Clean up multiple brackets, double spaces, leading/trailing dashes and spaces
  cleaned = cleaned.replace(/\[\s*\]/g, '');
  cleaned = cleaned.replace(/\(\s*\)/g, '');
  cleaned = cleaned.replace(/\s{2,}/g, ' ');
  cleaned = cleaned.replace(/^[\s\-_—·]+|[\s\-_—·]+$/g, '');

  return cleaned.trim();
}

const samples = [
  'Реакции #3 - &amp;#128077; ⚡️⚡️ (16₽)',
  'ID1238 🌟🤖Telegram Запуск бота Premium Аккаунты [База 100к]',
  '928. TG PREMIUM Boost/Буст [1 день] - База #1',
  'Премиум Подписчики [Русские Ники | Канал/Группа | HQ | 0-1/Ч | 10К/Д | С... [Эконом]',
  '⭐ RuTube просмотры видео | Старт 0-10 часов | Скорость ~10000-15000 в су... [Эконом]',
  'Нажатия &quot;В топ&quot; на видео Rutube [0-12/Ч | 1К/Д | Списания Возможны | Без Гарантии] [Эконом]',
  'Telegram Реакции [👍 ❤️ 🔥 🎉🤩 😁] [Для закрытого канала]',
  '🔥🇷🇺 Запуск бота [Принимает реферальный код][Россия][Сервер: 1]'
];

for (const s of samples) {
  console.log(`ORIGINAL: ${s}`);
  console.log(`CLEANED:  ${cleanServiceName(s)}\n`);
}
