/* Tables d'encodage pour les polices « simples » des PDF.
   WinAnsiEncoding est l'encodage de très loin le plus courant ; c'est aussi
   celui que suppose la spec quand une police non symbolique n'en déclare pas. */

export const WIN_ANSI: (string | undefined)[] = (() => {
  const t: (string | undefined)[] = new Array(256).fill(undefined);
  for (let i = 32; i <= 126; i++) t[i] = String.fromCharCode(i);
  for (let i = 0xa0; i <= 0xff; i++) t[i] = String.fromCharCode(i);
  const over: Record<number, string> = {
    0x80: '€', 0x82: '‚', 0x83: 'ƒ', 0x84: '„', 0x85: '…',
    0x86: '†', 0x87: '‡', 0x88: 'ˆ', 0x89: '‰', 0x8a: 'Š',
    0x8b: '‹', 0x8c: 'Œ', 0x8e: 'Ž', 0x91: '‘', 0x92: '’',
    0x93: '“', 0x94: '”', 0x95: '•', 0x96: '–', 0x97: '—',
    0x98: '˜', 0x99: '™', 0x9a: 'š', 0x9b: '›', 0x9c: 'œ',
    0x9e: 'ž', 0x9f: 'Ÿ',
  };
  for (const [k, v] of Object.entries(over)) t[Number(k)] = v;
  return t;
})();

/* Sous-ensemble de l'Adobe Glyph List : les noms rencontrés dans les
   /Differences des documents latins. Un nom inconnu rend le code
   correspondant « non inversible » (l'édition bascule alors en repli). */
const AGL: Record<string, string> = {
  space: ' ', exclam: '!', quotedbl: '"', numbersign: '#', dollar: '$', percent: '%',
  ampersand: '&', quotesingle: "'", parenleft: '(', parenright: ')', asterisk: '*',
  plus: '+', comma: ',', hyphen: '-', period: '.', slash: '/',
  zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6',
  seven: '7', eight: '8', nine: '9',
  colon: ':', semicolon: ';', less: '<', equal: '=', greater: '>', question: '?', at: '@',
  bracketleft: '[', backslash: '\\', bracketright: ']', asciicircum: '^', underscore: '_',
  grave: '`', braceleft: '{', bar: '|', braceright: '}', asciitilde: '~',
  exclamdown: '¡', cent: '¢', sterling: '£', currency: '¤',
  yen: '¥', brokenbar: '¦', section: '§', dieresis: '¨',
  copyright: '©', ordfeminine: 'ª', guillemotleft: '«',
  logicalnot: '¬', registered: '®', macron: '¯', degree: '°',
  plusminus: '±', acute: '´', mu: 'µ', paragraph: '¶',
  periodcentered: '·', cedilla: '¸', ordmasculine: 'º',
  guillemotright: '»', onequarter: '¼', onehalf: '½',
  threequarters: '¾', questiondown: '¿',
  Agrave: 'À', Aacute: 'Á', Acircumflex: 'Â', Atilde: 'Ã',
  Adieresis: 'Ä', Aring: 'Å', AE: 'Æ', Ccedilla: 'Ç',
  Egrave: 'È', Eacute: 'É', Ecircumflex: 'Ê', Edieresis: 'Ë',
  Igrave: 'Ì', Iacute: 'Í', Icircumflex: 'Î', Idieresis: 'Ï',
  Eth: 'Ð', Ntilde: 'Ñ', Ograve: 'Ò', Oacute: 'Ó',
  Ocircumflex: 'Ô', Otilde: 'Õ', Odieresis: 'Ö', multiply: '×',
  Oslash: 'Ø', Ugrave: 'Ù', Uacute: 'Ú', Ucircumflex: 'Û',
  Udieresis: 'Ü', Yacute: 'Ý', Thorn: 'Þ', germandbls: 'ß',
  agrave: 'à', aacute: 'á', acircumflex: 'â', atilde: 'ã',
  adieresis: 'ä', aring: 'å', ae: 'æ', ccedilla: 'ç',
  egrave: 'è', eacute: 'é', ecircumflex: 'ê', edieresis: 'ë',
  igrave: 'ì', iacute: 'í', icircumflex: 'î', idieresis: 'ï',
  eth: 'ð', ntilde: 'ñ', ograve: 'ò', oacute: 'ó',
  ocircumflex: 'ô', otilde: 'õ', odieresis: 'ö', divide: '÷',
  oslash: 'ø', ugrave: 'ù', uacute: 'ú', ucircumflex: 'û',
  udieresis: 'ü', yacute: 'ý', thorn: 'þ', ydieresis: 'ÿ',
  OE: 'Œ', oe: 'œ', Scaron: 'Š', scaron: 'š', Ydieresis: 'Ÿ',
  Zcaron: 'Ž', zcaron: 'ž', florin: 'ƒ', circumflex: 'ˆ',
  caron: 'ˇ', tilde: '˜', endash: '–', emdash: '—',
  quoteleft: '‘', quoteright: '’', quotesinglbase: '‚',
  quotedblleft: '“', quotedblright: '”', quotedblbase: '„',
  dagger: '†', daggerdbl: '‡', bullet: '•', ellipsis: '…',
  perthousand: '‰', guilsinglleft: '‹', guilsinglright: '›',
  Euro: '€', trademark: '™', minus: '−', fi: 'ﬁ', fl: 'ﬂ',
};

export function glyphToChar(name: string): string | undefined {
  if (AGL[name] !== undefined) return AGL[name];
  let m = /^uni([0-9A-Fa-f]{4})$/.exec(name);
  if (m) return String.fromCharCode(parseInt(m[1], 16));
  m = /^u([0-9A-Fa-f]{4,6})$/.exec(name);
  if (m) return String.fromCodePoint(parseInt(m[1], 16));
  return undefined;
}
