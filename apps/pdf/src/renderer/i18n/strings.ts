import { defineStrings } from '@hermesoffice/i18n'
import { zh } from './strings/zh'
import { en } from './strings/en'
import { ja } from './strings/ja'
import { ko } from './strings/ko'
import { fr } from './strings/fr'
import { de } from './strings/de'
import { es } from './strings/es'
import { th } from './strings/th'
import { id } from './strings/id'
import { ru } from './strings/ru'
import { ar } from './strings/ar'
import { pt } from './strings/pt'
import { it } from './strings/it'
import { pl } from './strings/pl'
import { cs } from './strings/cs'
import { nl } from './strings/nl'
import { ms } from './strings/ms'
import { he } from './strings/he'
import { hi } from './strings/hi'
import { zhTW } from './strings/zh-TW'

/** PDF chrome strings; zh defines the key set every locale shard must match. */
export const strings = defineStrings({
  zh: zh,
  en: en,
  ja: ja,
  ko: ko,
  fr: fr,
  de: de,
  es: es,
  th: th,
  id: id,
  ru: ru,
  ar: ar,
  pt: pt,
  it: it,
  pl: pl,
  cs: cs,
  nl: nl,
  ms: ms,
  he: he,
  hi: hi,
  'zh-TW': zhTW,
})
