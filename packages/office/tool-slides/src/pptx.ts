/**
 * A deck written as a real `.pptx`: the OOXML package a presentation is.
 *
 * The writer owns the whole part graph a reader needs — content types,
 * relationships, the presentation, one master, three layouts, a theme, the
 * document properties, and one part per slide — and draws each slide into the
 * placeholder of the layout it names. Nothing here talks to a filesystem or to
 * Cordis: a deck goes in, the package's bytes come out, so the caller decides
 * where they land.
 *
 * The layouts are the predefined ones this writer offers, not a template the
 * caller supplies: a title slide built from the deck's own title and subtitle,
 * then section headers and bullet slides. Text is escaped on the way in, so a
 * title carrying `<` or `&` cannot break the XML it sits in.
 */
import { strToU8, zipSync } from 'fflate'

/** The three layouts a generated deck draws from. */
export type SlideLayout = 'section' | 'bullets'

/**
 * The predefined templates a generated deck may be built on.
 *
 * A template is the deck's colour scheme, font pair, and background together:
 * the master paints its background from the scheme, and the theme carries the
 * values, so a template changes the whole deck without touching a slide.
 */
export type DeckTemplate = 'default' | 'dark' | 'print'

/** One template's theme values. */
interface TemplateTheme {
  /** Window/text pair the master's colour map resolves through. */
  readonly dark: string
  readonly light: string
  /** Secondary text and panel colours. */
  readonly dark2: string
  readonly light2: string
  /** The accent a section heading is drawn in. */
  readonly accent1: string
  readonly accent2: string
  readonly accent3: string
  readonly accent4: string
  readonly accent5: string
  readonly accent6: string
  readonly hyperlink: string
  readonly followedLink: string
  /** Heading and body typefaces. */
  readonly majorFont: string
  readonly minorFont: string
}

const TEMPLATES: Readonly<Record<DeckTemplate, TemplateTheme>> = {
  default: {
    dark: '000000', light: 'FFFFFF', dark2: '1F2328', light2: 'F6F8FA',
    accent1: '0B5FFF', accent2: '1F883D', accent3: 'BF8700', accent4: 'CF222E',
    accent5: '8250DF', accent6: '1B7C83', hyperlink: '0969DA', followedLink: '8250DF',
    majorFont: 'Calibri Light', minorFont: 'Calibri',
  },
  dark: {
    dark: 'F0F3F6', light: '14181D', dark2: 'D0D7DE', light2: '1F2429',
    accent1: '6EA8FF', accent2: '57D364', accent3: 'E3B341', accent4: 'FF7B72',
    accent5: 'BC8CFF', accent6: '56D4DD', hyperlink: '6EA8FF', followedLink: 'BC8CFF',
    majorFont: 'Calibri Light', minorFont: 'Calibri',
  },
  print: {
    dark: '000000', light: 'FFFFFF', dark2: '3B3B3B', light2: 'F2F2F2',
    accent1: '1A1A1A', accent2: '3B3B3B', accent3: '595959', accent4: '262626',
    accent5: '4D4D4D', accent6: '6B6B6B', hyperlink: '1A1A1A', followedLink: '595959',
    majorFont: 'Cambria', minorFont: 'Georgia',
  },
}

/** One content slide of a deck. */
export interface DeckSlide {
  /** Which predefined layout draws this slide. */
  readonly layout: SlideLayout
  /** The slide's heading. */
  readonly title: string
  /** The bullet lines of a `bullets` slide, one paragraph each. */
  readonly bullets?: readonly string[]
}

/** Everything one generated deck states. */
export interface Deck {
  /** The deck's title, drawn on the title slide. */
  readonly title: string
  /** The title slide's subtitle, when the deck has one. */
  readonly subtitle?: string
  /** The template the deck is built on. */
  readonly template: DeckTemplate
  /** The content slides, in order. */
  readonly slides: readonly DeckSlide[]
}

/** The namespaces every part root declares. */
const NS = {
  a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
  r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  p: 'http://schemas.openxmlformats.org/presentationml/2006/main',
} as const

const PACKAGE_RELS = 'http://schemas.openxmlformats.org/package/2006/relationships'
const CONTENT_TYPES = 'http://schemas.openxmlformats.org/package/2006/content-types'
const OFFICE_DOCUMENT = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument'
const SLIDE_MASTER = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster'
const SLIDE_LAYOUT = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout'
const SLIDE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide'
const THEME = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme'

/** Slide size for the 16:9 canvas, in EMU. */
const SLIDE_WIDTH = 12192000
const SLIDE_HEIGHT = 6858000

/** Escape the five characters that would otherwise change the XML they sit in. */
function escapeXml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

/** The XML declaration every part opens with. */
const DECLARATION = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'

/** The empty shape tree every slide and layout carries before its placeholders. */
function shapeTree(shapes: readonly string[]): string {
  return [
    '<p:spTree>',
    '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>',
    '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>',
    ...shapes,
    '</p:spTree>',
  ].join('')
}

/**
 * One run of text with its size.
 * @param text - the text to draw.
 * @param size - the run's point size, in hundredths of a point, when it states one.
 * @returns the run's XML.
 */
function run(text: string, size?: number, schemeColor?: string): string {
  const fill = schemeColor === undefined ? '' : `<a:solidFill><a:schemeClr val="${schemeColor}"/></a:solidFill>`
  const properties = `<a:rPr lang="en-US"${size === undefined ? '' : ` sz="${size}"`} dirty="0">${fill}</a:rPr>`
  return `<a:r>${properties}<a:t>${escapeXml(text)}</a:t></a:r>`
}

/**
 * One placeholder shape.
 * @param id - the shape's id inside its slide.
 * @param name - the shape's name.
 * @param placeholder - the placeholder reference, e.g. `type="title"` or `idx="1"`.
 * @param offset - the shape's `x`/`y` in EMU.
 * @param extent - the shape's width/height in EMU.
 * @param paragraphs - the paragraphs the shape holds.
 * @returns the shape's XML.
 */
function placeholder(
  id: number,
  name: string,
  placeholder: string,
  offset: readonly [number, number],
  extent: readonly [number, number],
  paragraphs: readonly string[],
): string {
  return [
    '<p:sp>',
    `<p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>`,
    `<p:nvPr><p:ph ${placeholder}/></p:nvPr></p:nvSpPr>`,
    `<p:spPr><a:xfrm><a:off x="${offset[0]}" y="${offset[1]}"/><a:ext cx="${extent[0]}" cy="${extent[1]}"/></a:xfrm></p:spPr>`,
    `<p:txBody><a:bodyPr/><a:lstStyle/>${paragraphs.join('')}</p:txBody>`,
    '</p:sp>',
  ].join('')
}

/**
 * One paragraph holding a single run.
 * @param text - the paragraph's text.
 * @param size - the run's point size, in hundredths of a point, when it states one.
 * @returns the paragraph's XML.
 */
function paragraph(text: string, size?: number, schemeColor?: string): string {
  return `<a:p>${run(text, size, schemeColor)}</a:p>`
}

/**
 * One bulleted paragraph.
 * @param text - the bullet's text.
 * @returns the paragraph's XML.
 */
function bullet(text: string): string {
  return `<a:p><a:pPr lvl="0"><a:buFont typeface="Arial"/><a:buChar char="&#8226;"/></a:pPr>${run(text)}</a:p>`
}

/** The paragraph an empty placeholder holds. */
const EMPTY_PARAGRAPH = '<a:p><a:endParaRPr lang="en-US" dirty="0"/></a:p>'

/**
 * The slide parts of a layout, ready to be placed on a slide.
 * @param layout - the layout the slide uses.
 * @returns the shapes the layout contributes to the slide.
 */
function shapesOf(layout: SlideLayout, slide: DeckSlide): string[] {
  if (layout === 'section') {
    return [placeholder(2, 'Title 1', 'type="title"', [838200, 2746388], [10515600, 1143000], [paragraph(slide.title, 4000, 'accent1')])]
  }
  const bullets = slide.bullets ?? []
  return [
    placeholder(2, 'Title 1', 'type="title"', [838200, 365125], [10515600, 1325563], [paragraph(slide.title, 3200)]),
    placeholder(
      3,
      'Content 1',
      'idx="1"',
      [838200, 1825625],
      [10515600, 4351338],
      bullets.length === 0 ? [EMPTY_PARAGRAPH] : bullets.map(bullet),
    ),
  ]
}

/**
 * The title slide, drawn from the deck's own title and subtitle.
 * @param deck - the deck being written.
 * @returns the slide's XML.
 */
function titleSlide(deck: Deck): string {
  return [
    DECLARATION,
    `<p:sld xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}">`,
    '<p:cSld>',
    shapeTree([
      placeholder(2, 'Title 1', 'type="ctrTitle"', [838200, 1825625], [10515600, 1143000], [paragraph(deck.title, 4400)]),
      placeholder(
        3,
        'Subtitle 2',
        'type="subTitle"',
        [1371600, 3200400],
        [9144000, 1657350],
        deck.subtitle === undefined ? [EMPTY_PARAGRAPH] : [paragraph(deck.subtitle)],
      ),
    ]),
    '</p:cSld>',
    '<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>',
    '</p:sld>',
  ].join('')
}

/**
 * One content slide.
 * @param slide - the slide to draw.
 * @returns the slide's XML.
 */
function contentSlide(slide: DeckSlide): string {
  return [
    DECLARATION,
    `<p:sld xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}">`,
    '<p:cSld>',
    shapeTree(shapesOf(slide.layout, slide)),
    '</p:cSld>',
    '<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>',
    '</p:sld>',
  ].join('')
}

/**
 * One slide layout part.
 * @param type - the layout type the presentation schema knows.
 * @param name - the layout's display name.
 * @param shapes - the placeholders the layout declares.
 * @returns the layout's XML.
 */
function layoutPart(type: string, name: string, shapes: readonly string[]): string {
  return [
    DECLARATION,
    `<p:sldLayout xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}" type="${type}" preserve="1">`,
    `<p:cSld name="${name}">`,
    shapeTree(shapes),
    '</p:cSld>',
    '<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>',
    '</p:sldLayout>',
  ].join('')
}

/** One template's theme: its colour scheme and font pair. */
function themePart(template: DeckTemplate): string {
  const theme = TEMPLATES[template]
  const fill = '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>'
  return [
    DECLARATION,
    `<a:theme xmlns:a="${NS.a}" name="DeepSeek Harness ${template}">`,
    '<a:themeElements>',
    `<a:clrScheme name="${template}">`,
    `<a:dk1><a:srgbClr val="${theme.dark}"/></a:dk1>`,
    `<a:lt1><a:srgbClr val="${theme.light}"/></a:lt1>`,
    `<a:dk2><a:srgbClr val="${theme.dark2}"/></a:dk2>`,
    `<a:lt2><a:srgbClr val="${theme.light2}"/></a:lt2>`,
    `<a:accent1><a:srgbClr val="${theme.accent1}"/></a:accent1>`,
    `<a:accent2><a:srgbClr val="${theme.accent2}"/></a:accent2>`,
    `<a:accent3><a:srgbClr val="${theme.accent3}"/></a:accent3>`,
    `<a:accent4><a:srgbClr val="${theme.accent4}"/></a:accent4>`,
    `<a:accent5><a:srgbClr val="${theme.accent5}"/></a:accent5>`,
    `<a:accent6><a:srgbClr val="${theme.accent6}"/></a:accent6>`,
    `<a:hlink><a:srgbClr val="${theme.hyperlink}"/></a:hlink>`,
    `<a:folHlink><a:srgbClr val="${theme.followedLink}"/></a:folHlink>`,
    '</a:clrScheme>',
    '<a:fontScheme name="Office">',
    `<a:majorFont><a:latin typeface="${theme.majorFont}"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>`,
    `<a:minorFont><a:latin typeface="${theme.minorFont}"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont>`,
    '</a:fontScheme>',
    '<a:fmtScheme name="Office">',
    `<a:fillStyleLst>${fill}${fill}${fill}</a:fillStyleLst>`,
    `<a:lnStyleLst><a:ln w="6350" cap="flat" cmpd="sng" algn="ctr">${fill}</a:ln><a:ln w="12700" cap="flat" cmpd="sng" algn="ctr">${fill}</a:ln><a:ln w="19050" cap="flat" cmpd="sng" algn="ctr">${fill}</a:ln></a:lnStyleLst>`,
    '<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>',
    `<a:bgFillStyleLst>${fill}${fill}${fill}</a:bgFillStyleLst>`,
    '</a:fmtScheme>',
    '</a:themeElements>',
    '<a:objectDefaults/><a:extraClrSchemeLst/>',
    '</a:theme>',
  ].join('')
}

/**
 * The slide master: the layout list, the colour map, and the text styles.
 * @param layoutCount - how many layouts the deck carries.
 * @returns the master's XML.
 */
function masterPart(layoutCount: number): string {
  const layouts = Array.from({ length: layoutCount }, (_, index) =>
    `<p:sldLayoutId id="${2147483649 + index}" r:id="rId${index + 1}"/>`).join('')
  return [
    DECLARATION,
    `<p:sldMaster xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}">`,
    '<p:cSld>',
    // The background follows the scheme's light slot, so a template that makes
    // that slot dark paints the whole deck dark without touching a slide.
    '<p:bg><p:bgPr><a:solidFill><a:schemeClr val="lt1"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>',
    shapeTree([]),
    '</p:cSld>',
    '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>',
    `<p:sldLayoutIdLst>${layouts}</p:sldLayoutIdLst>`,
    '<p:txStyles>',
    '<p:titleStyle><a:lvl1pPr algn="l"><a:defRPr sz="4400" b="0"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill></a:defRPr></a:lvl1pPr></p:titleStyle>',
    '<p:bodyStyle><a:lvl1pPr marL="342900" indent="-342900"><a:defRPr sz="2000"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill></a:defRPr></a:lvl1pPr><a:lvl2pPr marL="742950" indent="-285750"><a:defRPr sz="1800"/></a:lvl2pPr></p:bodyStyle>',
    '<p:otherStyle><a:lvl1pPr><a:defRPr sz="1800"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill></a:defRPr></a:lvl1pPr></p:otherStyle>',
    '</p:txStyles>',
    '</p:sldMaster>',
  ].join('')
}

/**
 * One relationships part.
 * @param relationships - each relationship's `Id`, `Type`, and `Target`.
 * @returns the part's XML.
 */
function relsPart(relationships: readonly { readonly id: string; readonly type: string; readonly target: string }[]): string {
  const entries = relationships.map(relationship =>
    `<Relationship Id="${relationship.id}" Type="${relationship.type}" Target="${relationship.target}"/>`).join('')
  return `${DECLARATION}<Relationships xmlns="${PACKAGE_RELS}">${entries}</Relationships>`
}

/**
 * The package's content types: every part's declared type.
 * @param slideCount - how many slide parts the package holds.
 * @returns the part's XML.
 */
function contentTypes(slideCount: number): string {
  const slides = Array.from({ length: slideCount }, (_, index) =>
    `<Override PartName="/ppt/slides/slide${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join('')
  const layouts = Array.from({ length: 3 }, (_, index) =>
    `<Override PartName="/ppt/slideLayouts/slideLayout${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>`).join('')
  return [
    DECLARATION,
    `<Types xmlns="${CONTENT_TYPES}">`,
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
    '<Default Extension="xml" ContentType="application/xml"/>',
    '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>',
    '<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>',
    layouts,
    '<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>',
    slides,
    '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>',
    '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>',
    '</Types>',
  ].join('')
}

/**
 * The document properties a reader shows for the deck.
 * @param deck - the deck being written.
 * @param slideCount - how many slides the package holds.
 * @param timestamp - the W3CDTF instant the deck was written.
 * @returns the two property parts by their package path.
 */
function properties(deck: Deck, slideCount: number, timestamp: string): Record<string, string> {
  return {
    'docProps/core.xml': [
      DECLARATION,
      '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"'
      + ' xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/"'
      + ' xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">',
      `<dc:title>${escapeXml(deck.title)}</dc:title>`,
      '<dc:creator>DeepSeek Harness</dc:creator>',
      '<cp:lastModifiedBy>DeepSeek Harness</cp:lastModifiedBy>',
      `<dcterms:created xsi:type="dcterms:W3CDTF">${timestamp}</dcterms:created>`,
      `<dcterms:modified xsi:type="dcterms:W3CDTF">${timestamp}</dcterms:modified>`,
      '</cp:coreProperties>',
    ].join(''),
    'docProps/app.xml': [
      DECLARATION,
      '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"'
      + ' xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">',
      '<Application>DeepSeek Harness</Application>',
      `<Slides>${slideCount}</Slides>`,
      '</Properties>',
    ].join(''),
  }
}

/**
 * Write one deck as a `.pptx` package.
 *
 * The title slide always comes first, drawn from the deck's title and subtitle;
 * the slides that follow use the layout each one names. A slide's text is
 * escaped, and every part the presentation references is present in the
 * package, because a reader that cannot resolve a relationship refuses the
 * file rather than showing it without that part.
 * @param deck - the deck to write.
 * @param now - the instant the deck is written, for its document properties.
 * @returns the package's bytes.
 */
export function buildPresentation(deck: Deck, now: Date = new Date()): Uint8Array {
  const slideParts = [titleSlide(deck), ...deck.slides.map(contentSlide)]
  const slideCount = slideParts.length
  const timestamp = now.toISOString().replace(/\.\d{3}Z$/u, 'Z')
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(contentTypes(slideCount)),
    '_rels/.rels': strToU8(relsPart([
      { id: 'rId1', type: OFFICE_DOCUMENT, target: 'ppt/presentation.xml' },
      { id: 'rId2', type: 'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties', target: 'docProps/core.xml' },
      { id: 'rId3', type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties', target: 'docProps/app.xml' },
    ])),
    'ppt/presentation.xml': strToU8([
      DECLARATION,
      `<p:presentation xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}" saveSubsetFonts="1">`,
      '<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>',
      '<p:sldIdLst>',
      ...slideParts.map((_, index) => `<p:sldId id="${256 + index}" r:id="rId${index + 2}"/>`),
      '</p:sldIdLst>',
      `<p:sldSz cx="${SLIDE_WIDTH}" cy="${SLIDE_HEIGHT}" type="screen16x9"/>`,
      '<p:notesSz cx="6858000" cy="9144000"/>',
      '</p:presentation>',
    ].join('')),
    'ppt/_rels/presentation.xml.rels': strToU8(relsPart([
      { id: 'rId1', type: SLIDE_MASTER, target: 'slideMasters/slideMaster1.xml' },
      ...slideParts.map((_, index) => ({ id: `rId${index + 2}`, type: SLIDE, target: `slides/slide${index + 1}.xml` })),
      { id: `rId${slideCount + 2}`, type: THEME, target: 'theme/theme1.xml' },
    ])),
    'ppt/slideMasters/slideMaster1.xml': strToU8(masterPart(3)),
    'ppt/slideMasters/_rels/slideMaster1.xml.rels': strToU8(relsPart([
      ...Array.from({ length: 3 }, (_, index) => ({ id: `rId${index + 1}`, type: SLIDE_LAYOUT, target: `../slideLayouts/slideLayout${index + 1}.xml` })),
      { id: 'rId4', type: THEME, target: '../theme/theme1.xml' },
    ])),
    'ppt/slideLayouts/slideLayout1.xml': strToU8(layoutPart('title', 'Title Slide', [
      placeholder(2, 'Title 1', 'type="ctrTitle"', [838200, 1825625], [10515600, 1143000], [EMPTY_PARAGRAPH]),
      placeholder(3, 'Subtitle 2', 'type="subTitle"', [1371600, 3200400], [9144000, 1657350], [EMPTY_PARAGRAPH]),
    ])),
    'ppt/slideLayouts/slideLayout2.xml': strToU8(layoutPart('secHead', 'Section Header', [
      placeholder(2, 'Title 1', 'type="title"', [838200, 2746388], [10515600, 1143000], [EMPTY_PARAGRAPH]),
    ])),
    'ppt/slideLayouts/slideLayout3.xml': strToU8(layoutPart('obj', 'Title and Content', [
      placeholder(2, 'Title 1', 'type="title"', [838200, 365125], [10515600, 1325563], [EMPTY_PARAGRAPH]),
      placeholder(3, 'Content 1', 'idx="1"', [838200, 1825625], [10515600, 4351338], [EMPTY_PARAGRAPH]),
    ])),
    'ppt/theme/theme1.xml': strToU8(themePart(deck.template)),
    // The property parts arrive as text like every other part, so they are
    // encoded the same way before the archive sees them.
    ...Object.fromEntries(Object.entries(properties(deck, slideCount, timestamp)).map(([path, part]) => [path, strToU8(part)])),
  }
  for (const [index, part] of slideParts.entries()) {
    const layout = index === 0 ? 1 : deck.slides[index - 1]?.layout === 'section' ? 2 : 3
    files[`ppt/slides/slide${index + 1}.xml`] = strToU8(part)
    files[`ppt/slides/_rels/slide${index + 1}.xml.rels`] = strToU8(relsPart([
      { id: 'rId1', type: SLIDE_LAYOUT, target: `../slideLayouts/slideLayout${layout}.xml` },
    ]))
  }
  // A fixed modification time keeps the same deck producing the same bytes,
  // which is what makes a regenerated file comparable to the one it replaced.
  return zipSync(files, { level: 6, mtime: now })
}
