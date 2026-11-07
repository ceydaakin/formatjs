import {type NumberSkeletonToken} from '@formatjs/icu-skeleton-parser'
import {
  type ArgumentElement,
  type DateElement,
  type DateTimeSkeleton,
  isArgumentElement,
  isDateElement,
  isLiteralElement,
  isNumberElement,
  isPluralElement,
  isPoundElement,
  isSelectElement,
  isTagElement,
  isTimeElement,
  type LiteralElement,
  type MessageFormatElement,
  type NumberElement,
  type PluralElement,
  type SelectElement,
  type Skeleton,
  SKELETON_TYPE,
  type TagElement,
  type TimeElement,
  TYPE,
} from '#packages/icu-messageformat-parser/types.js'

export function printAST(ast: MessageFormatElement[]): string {
  return doPrintAST(ast, false)
}

export function doPrintAST(
  ast: MessageFormatElement[],
  isInPlural: boolean
): string {
  const printedNodes = ast.map((el, i) => {
    if (isLiteralElement(el)) {
      return printLiteralElement(el, isInPlural, i === 0, i === ast.length - 1)
    }

    if (isArgumentElement(el)) {
      return printArgumentElement(el)
    }
    if (isDateElement(el) || isTimeElement(el) || isNumberElement(el)) {
      return printSimpleFormatElement(el)
    }

    if (isPluralElement(el)) {
      return printPluralElement(el)
    }

    if (isSelectElement(el)) {
      return printSelectElement(el)
    }

    if (isPoundElement(el)) {
      return '#'
    }
    if (isTagElement(el)) {
      return printTagElement(el, isInPlural)
    }
  })

  return printedNodes.join('')
}

function printTagElement(el: TagElement, isInPlural: boolean): string {
  return `<${el.value}>${doPrintAST(el.children, isInPlural)}</${el.value}>`
}

function quoteSyntaxToken(token: string): string {
  return `'${token.split("'").join("''")}'`
}

function isAlpha(ch: string | undefined): boolean {
  if (!ch) {
    return false
  }
  const code = ch.charCodeAt(0)
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122)
}

function isTagSyntaxStart(message: string, index: number): boolean {
  if (message[index] !== '<') {
    return false
  }
  const next = message[index + 1]
  return next === '/' || isAlpha(next)
}

function findTagSyntaxEnd(message: string, index: number): number {
  const closingIndex = message.indexOf('>', index + 1)
  return closingIndex === -1 ? message.length : closingIndex + 1
}

function findBraceSyntaxEnd(message: string, index: number): number {
  const closingIndex = message.indexOf('}', index + 1)
  return closingIndex === -1 ? index + 1 : closingIndex + 1
}

/**
 * Doubles each run of apostrophes in unquoted literal text that the parser
 * would otherwise read as an escape or a quote start: runs of two or more
 * (`''` reads back as one `'`), runs before `<` or `>`, and runs at an edge
 * that touches syntax (a quoted span, an argument or a tag).
 */
function escapeLiteralApostrophes(
  text: string,
  escapeStart: boolean,
  escapeEnd: boolean
): string {
  let result = ''
  let i = 0
  while (i < text.length) {
    if (text[i] !== "'") {
      result += text[i]
      i++
      continue
    }
    let end = i
    while (text[end] === "'") {
      end++
    }
    const run = text.slice(i, end)
    const next = text[end]
    const mustDouble =
      run.length > 1 ||
      next === '<' ||
      next === '>' ||
      (i === 0 && escapeStart) ||
      (end === text.length && escapeEnd)
    result += mustDouble ? run + run : run
    i = end
  }
  return result
}

function isApostropheRun(text: string): boolean {
  for (const ch of text) {
    if (ch !== "'") {
      return false
    }
  }
  return true
}

interface LiteralEdges {
  escapeStart: boolean
  escapeEnd: boolean
}

function printEscapedMessage(
  message: string,
  isInPlural = false,
  literalEdges?: LiteralEdges
): string {
  let result = ''
  let literalStart = 0
  let quotedStart = -1
  let quotedEnd = -1

  function flushQuotedToken() {
    if (quotedStart === -1) {
      return
    }

    const literal = message.slice(literalStart, quotedStart)
    if (literalEdges) {
      result += escapeLiteralApostrophes(
        literal,
        literalStart === 0 ? literalEdges.escapeStart : true,
        true
      )
    } else {
      result += literal
      if (literal.endsWith("'")) {
        result += "'"
      }
    }
    result += quoteSyntaxToken(message.slice(quotedStart, quotedEnd))
    literalStart = quotedEnd
    quotedStart = -1
  }

  function quoteToken(start: number, end: number) {
    // Apostrophes between two quoted spans join the span: closing and
    // reopening a quote around them would pair the closing quote with them.
    if (
      quotedStart !== -1 &&
      (start === quotedEnd ||
        (literalEdges !== undefined &&
          isApostropheRun(message.slice(quotedEnd, start))))
    ) {
      quotedEnd = end
      return
    }

    flushQuotedToken()
    quotedStart = start
    quotedEnd = end
  }

  for (let i = 0; i < message.length; i++) {
    const ch = message[i]
    if (ch === '{') {
      const end = findBraceSyntaxEnd(message, i)
      quoteToken(i, end)
      i = end - 1
    } else if (ch === '}') {
      quoteToken(i, i + 1)
    } else if (isTagSyntaxStart(message, i)) {
      const end = findTagSyntaxEnd(message, i)
      quoteToken(i, end)
      i = end - 1
    } else if (isInPlural && ch === '#') {
      quoteToken(i, i + 1)
    }
  }

  flushQuotedToken()
  const tail = message.slice(literalStart)
  if (!literalEdges) {
    return result + tail
  }
  return (
    result +
    escapeLiteralApostrophes(
      tail,
      literalStart === 0 ? literalEdges.escapeStart : true,
      literalEdges.escapeEnd
    )
  )
}

function printLiteralElement(
  {value}: LiteralElement,
  isInPlural: boolean,
  isFirstEl: boolean,
  isLastEl: boolean
) {
  // An apostrophe at the start of a non-first literal or at the end of a
  // non-last literal touches the neighbouring element's syntax, so it is
  // doubled to keep it a literal apostrophe.
  return printEscapedMessage(value, isInPlural, {
    escapeStart: !isFirstEl,
    escapeEnd: !isLastEl,
  })
}

function printArgumentElement({value}: ArgumentElement) {
  return `{${value}}`
}

function printSimpleFormatElement(
  el: DateElement | TimeElement | NumberElement
) {
  return `{${el.value}, ${TYPE[el.type]}${
    el.style ? `, ${printArgumentStyle(el.style)}` : ''
  }}`
}

function printNumberSkeletonToken(token: NumberSkeletonToken): string {
  const {stem, options} = token
  return options.length === 0
    ? stem
    : `${stem}${options.map(o => `/${o}`).join('')}`
}

function printArgumentStyle(style: string | Skeleton) {
  if (typeof style === 'string') {
    return printEscapedMessage(style)
  } else if (style.type === SKELETON_TYPE.dateTime) {
    return `::${printDateTimeSkeleton(style)}`
  } else {
    return `::${style.tokens.map(printNumberSkeletonToken).join(' ')}`
  }
}

export function printDateTimeSkeleton(style: DateTimeSkeleton): string {
  return style.pattern
}

// Rust string ordering is UTF-8 lexicographic, which matches code point order.
function compareCodePoints(a: string, b: string): number {
  const aIter = a[Symbol.iterator]()
  const bIter = b[Symbol.iterator]()

  while (true) {
    const aNext = aIter.next()
    const bNext = bIter.next()
    if (aNext.done || bNext.done) {
      return aNext.done === bNext.done ? 0 : aNext.done ? -1 : 1
    }

    const diff = aNext.value.codePointAt(0)! - bNext.value.codePointAt(0)!
    if (diff !== 0) {
      return diff
    }
  }
}

function printSelectElement(el: SelectElement) {
  const keys = Object.keys(el.options).sort(compareCodePoints)
  const msg = [
    el.value,
    'select',
    keys
      .map(id => `${id}{${doPrintAST(el.options[id].value, false)}}`)
      .join(' '),
  ].join(',')
  return `{${msg}}`
}

const PLURAL_RULE_ORDER: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  few: 3,
  many: 4,
  other: 5,
}

function getPluralRuleSortOrder(rule: string): [number, number] {
  const categoryOrder = PLURAL_RULE_ORDER[rule]
  if (categoryOrder !== undefined) {
    return [categoryOrder, 0]
  }

  const exactRule = rule.replace(/^=+/, '')
  const exactValue = /^[+-]?\d+$/.test(exactRule) ? Number(exactRule) : 0
  return [6, exactValue]
}

function printPluralElement(el: PluralElement) {
  const type = el.pluralType === 'cardinal' ? 'plural' : 'selectordinal'
  const keys = Object.keys(el.options).sort((a, b) => {
    const [pa, sa] = getPluralRuleSortOrder(a)
    const [pb, sb] = getPluralRuleSortOrder(b)
    return pa - pb || sa - sb
  })
  const msg = [
    el.value,
    type,
    [
      el.offset ? `offset:${el.offset}` : '',
      ...keys.map(id => `${id}{${doPrintAST(el.options[id].value, true)}}`),
    ]
      .filter(Boolean)
      .join(' '),
  ].join(',')
  return `{${msg}}`
}
