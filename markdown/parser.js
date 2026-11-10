// ============================================================================
// Markdown line parser (pure JavaScript, no GI imports)
// ============================================================================
//
// Jotite renders markdown line by line. The only state that crosses lines is
// whether a line is inside a fenced code block or a multi-line HTML comment;
// classifyLine() computes that state (fenceIn -> fenceOut) so the renderer
// can re-parse only edited lines and continue downwards until the state
// converges again.
//
// parseLine() turns one line into a LineModel describing what to style. All
// offsets in a LineModel are Unicode code point columns, which is how
// GtkTextIter counts (JavaScript strings count UTF-16 units, so every emoji
// would otherwise shift later offsets by one).
//
// Supported syntax (CommonMark-based, per line):
//   ATX headings (# .. ######), thematic breaks (---, ***, ___, * * *),
//   fenced code (``` and ~~~, CommonMark open/close rules), HTML comments,
//   block quotes (> and nested > >), bullet lists (- * +), ordered lists
//   (1. and 1)), task boxes ([ ] / [x] after a list marker or at the start of
//   a line), backslash escapes, code spans (any backtick-string length),
//   emphasis and strong emphasis with CommonMark delimiter-run (flanking)
//   rules, GFM strikethrough (~~), inline links and images with balanced
//   parentheses and titles, <autolinks>, bare http(s)/ftp URLs, inline HTML
//   comments and visual arrows (-> <- <->).
// Not supported: setext headings (a "---" line is always a thematic break),
// indented code blocks, reference links, tables, multi-line emphasis.

const { MarkdownList } = imports.util.markdownList;

var Kind = {
    TEXT: 0,
    BLANK: 1,
    HEADING: 2,
    HR: 3,
    FENCE_OPEN: 4,
    FENCE_CLOSE: 5,
    CODE: 6,
    HTML: 7,
};

// First characters that may start a non-paragraph block line
const BLOCK_START_CHARS = new Set([' ', '\t', '`', '~', '<', '-', '*', '_', '#'].map(c => c.charCodeAt(0)));

// A group range that is revealed whenever the cursor is anywhere on the line
var LINE_GROUP_END = 0x7fffffff;

const FENCE_OPEN_RE = /^( {0,3})(`{3,}|~{3,})(.*)$/;
const FENCE_CLOSE_RE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;
const HR_RE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const HEADING_RE = /^( {0,3})(#{1,6})(?:[ \t]+|$)/;
const HTML_OPEN_RE = /^ {0,3}<!--/;
const BLANK_RE = /^[ \t]*$/;
const AUTOLINK_RE = /<([A-Za-z][A-Za-z0-9+.\-]{1,31}:[^\s<>]*)>/y;
const EMAIL_AUTOLINK_RE = /<([A-Za-z0-9.!#$%&'*+\/=?^_`{|}~\-]+@[A-Za-z0-9](?:[A-Za-z0-9\-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9\-]{0,61}[A-Za-z0-9])?)*)>/y;
const BARE_URL_RE = /(?:https?|ftp):\/\/[^\s<>]+/g;
const PUNCT_RE = /[\p{P}\p{S}]/u;
const WS_RE = /\s/u;
// Paragraph separators GtkTextBuffer breaks lines on: \r\n, \n, \r, U+2029
const LINE_SPLIT_RE = new RegExp('\\r\\n|\\n|\\r|' + String.fromCharCode(0x2029));

// Classify a line given the block state left by the previous line.
//   fenceIn/fenceOut: '' (normal), '<' (inside an HTML comment block), or a
//   fence key such as '`3' / '~4' (fence character and length).
function classifyLine(text, fenceIn = '') {
    if (fenceIn) {
        if (fenceIn === '<') {
            return { kind: Kind.HTML, fenceOut: text.includes('-->') ? '' : '<' };
        }
        const m = FENCE_CLOSE_RE.exec(text);
        if (m && m[1][0] === fenceIn[0] && m[1].length >= parseInt(fenceIn.slice(1)))
            return { kind: Kind.FENCE_CLOSE, fenceOut: '' };
        return { kind: Kind.CODE, fenceOut: fenceIn };
    }

    // Fast path: most lines start with a character that cannot begin any
    // block construct
    const first = text.charCodeAt(0);
    if (text.length > 0 && !BLOCK_START_CHARS.has(first))
        return { kind: Kind.TEXT, fenceOut: '' };

    let m = FENCE_OPEN_RE.exec(text);
    // A backtick fence's info string cannot contain backticks, so ```x```
    // on one line is an inline code span rather than an opening fence.
    if (m && !(m[2][0] === '`' && m[3].includes('`')))
        return { kind: Kind.FENCE_OPEN, fenceOut: m[2][0] + m[2].length };

    m = HTML_OPEN_RE.exec(text);
    if (m) {
        const closed = text.indexOf('-->', m[0].length - 2) >= 0;
        return { kind: Kind.HTML, fenceOut: closed ? '' : '<' };
    }

    if (BLANK_RE.test(text)) return { kind: Kind.BLANK, fenceOut: '' };
    if (HR_RE.test(text)) return { kind: Kind.HR, fenceOut: '' };

    m = HEADING_RE.exec(text);
    if (m && headingContent(text, m[0].length)) return { kind: Kind.HEADING, fenceOut: '' };

    return { kind: Kind.TEXT, fenceOut: '' };
}

// Content range of an ATX heading whose marker ends at contentStart, or null
// if the heading is empty. Strips an optional closing sequence (" ##").
function headingContent(text, contentStart) {
    let end = text.length;
    while (end > contentStart && (text[end - 1] === ' ' || text[end - 1] === '\t')) end--;
    let closeStart = end;
    let k = end;
    while (k > contentStart && text[k - 1] === '#') k--;
    if (k < end && (k === contentStart || text[k - 1] === ' ' || text[k - 1] === '\t')) {
        closeStart = k;
        while (closeStart > contentStart && (text[closeStart - 1] === ' ' || text[closeStart - 1] === '\t'))
            closeStart--;
    }
    if (closeStart <= contentStart) return null;
    return { contentEnd: closeStart, closeStart: closeStart < text.length ? closeStart : -1 };
}

// ASCII character classes (0 = other, 1 = whitespace, 2 = punctuation)
const ASCII_CLASS = new Uint8Array(128);
for (let c = 0; c < 128; c++) {
    const ch = String.fromCharCode(c);
    ASCII_CLASS[c] = WS_RE.test(ch) ? 1 : (PUNCT_RE.test(ch) ? 2 : 0);
}

function isWhitespace(ch) {
    if (ch === undefined || ch === '') return true;
    const c = ch.charCodeAt(0);
    return c < 128 ? ASCII_CLASS[c] === 1 : WS_RE.test(ch);
}

function isPunctuation(ch) {
    if (ch === undefined || ch === '') return false;
    const c = ch.charCodeAt(0);
    return c < 128 ? ASCII_CLASS[c] === 2 : PUNCT_RE.test(ch);
}

// ASCII punctuation (backslash-escapable characters)
function isAsciiPunctCode(c) {
    return c < 128 && ASCII_CLASS[c] === 2;
}

// Code point before UTF-16 index i (whole surrogate pair when needed)
function charBefore(t, i, start) {
    if (i <= start) return '';
    const c = t.charCodeAt(i - 1);
    if (c >= 0xDC00 && c <= 0xDFFF && i - 2 >= start) return t.slice(i - 2, i);
    return t[i - 1];
}

function charAt(t, i, end) {
    if (i >= end) return '';
    return String.fromCodePoint(t.codePointAt(i));
}

function unescapeUrl(s) {
    return s.replace(/\\([!-\/:-@\[-`{-~])/g, '$1');
}

function newModel(kind, fenceOut) {
    return {
        kind,
        fenceOut,
        spans: [],      // {s, e, t}: tag t always applied to [s, e)
        marks: [],      // {s, e, off, on, gs, ge}: tag `on` when the cursor
                        // column c satisfies gs <= c <= ge, else tag `off`
        links: [],      // {s, e, url}: clickable ranges
        codeSpans: [],  // {s, e}
        heading: null,  // {level, contentStart, contentEnd}
        list: null,     // {type: 'dash'|'star'|'plus'|'ordered', s, e}
        task: null,     // {s, checked}
        quote: null,    // {depth}
        prefix: null,   // {text, end, box}: line prefix used for hanging indent
                        // (text is the raw prefix, box its task box index or -1)
    };
}

function mark(model, s, e, off, on, gs, ge) {
    if (e > s) model.marks.push({ s, e, off, on, gs, ge });
}

function span(model, s, e, t) {
    if (e > s) model.spans.push({ s, e, t });
}

// CommonMark lets implementations limit parenthesis nesting in link
// destinations; the limit keeps scanning linear on lines like "[a]([a]([a](".
const MAX_DEST_PARENS = 16;
// Emphasis delimiter runs per scope beyond which a line is left plain
const MAX_DELIM_RUNS = 400;

// Parse a link destination and optional title starting just after "](".
// memo.titleFail[c]: a title scan for closing character c starting at or
// after this position is known to fail (it reached the end of the line).
function parseLinkTail(t, p, end, memo) {
    // Every inline link ends with ')'
    if (memo.lastParen === undefined) memo.lastParen = t.lastIndexOf(')', end - 1);
    if (p > memo.lastParen) return null;
    while (p < end && (t[p] === ' ' || t[p] === '\t')) p++;
    let destS, destE;
    if (t[p] === '<') {
        let q = p + 1;
        while (q < end && t[q] !== '>' && t[q] !== '<') {
            if (t[q] === '\\' && q + 1 < end) q++;
            q++;
        }
        if (q >= end || t[q] !== '>') return null;
        destS = p + 1;
        destE = q;
        p = q + 1;
    } else {
        let depth = 0;
        let q = p;
        while (q < end) {
            const c = t.charCodeAt(q);
            if (c === 92 && q + 1 < end && isAsciiPunctCode(t.charCodeAt(q + 1))) { // backslash
                q += 2;
                continue;
            }
            if (c <= 32) break; // space, tab, control
            if (c === 40) { // (
                if (++depth > MAX_DEST_PARENS) return null;
            } else if (c === 41) { // )
                if (depth === 0) break;
                depth--;
            }
            q++;
        }
        if (depth !== 0) return null;
        destS = p;
        destE = q;
        p = q;
    }
    const wsStart = p;
    while (p < end && (t[p] === ' ' || t[p] === '\t')) p++;
    if ((p > wsStart || destE === destS) && (t[p] === '"' || t[p] === "'" || t[p] === '(')) {
        const close = t[p] === '(' ? ')' : t[p];
        let q = p + 1;
        if (q >= memo.titleFail[close]) return null;
        while (q < end && t[q] !== close) {
            if (t[q] === '\\' && q + 1 < end) q++;
            q++;
        }
        if (q >= end) {
            // Every later scan for this character fails too (from p + 1 on
            // both scans visit the same positions)
            memo.titleFail[close] = Math.min(memo.titleFail[close], p + 1);
            return null;
        }
        p = q + 1;
        while (p < end && (t[p] === ' ' || t[p] === '\t')) p++;
    }
    if (p >= end || t[p] !== ')') return null;
    return { destS, destE, end: p + 1, url: unescapeUrl(t.slice(destS, destE)) };
}

// Parse inline content t[start, end) into model (UTF-16 indices).
function parseInline(t, start, end, model) {
    if (end <= start) return;
    // excl[i] = 1: character is consumed by an opaque construct (escape,
    // code span, autolink, comment, link syntax, URL) and cannot take part
    // in emphasis, links or arrows.
    const excl = new Uint8Array(end + 1);
    const fill = (s, e) => excl.fill(1, s, e);
    // Memoised searches keep long pathological lines linear
    const memo = { titleFail: { '"': Infinity, "'": Infinity, ')': Infinity } };
    let commentFrom = -1, commentAt = -1; // last '-->' search: start, result
    let runsByLen = null;                 // backtick run length -> {pos[], k}

    // Pass 1: backslash escapes, code spans, autolinks, inline comments
    let i = start;
    while (i < end) {
        const c = t.charCodeAt(i);
        if (c === 92) { // backslash
            if (i + 1 < end && isAsciiPunctCode(t.charCodeAt(i + 1))) {
                mark(model, i, i + 1, 'invisible', 'dim', i, i + 2);
                excl[i] = excl[i + 1] = 1;
                i += 2;
                continue;
            }
            i++;
            continue;
        }
        if (c === 96) { // backtick
            let n = 1;
            while (i + n < end && t.charCodeAt(i + n) === 96) n++;
            // Closer: the first backtick run of exactly n after the opener
            if (!runsByLen) runsByLen = backtickRuns(t, i, end);
            const runs = runsByLen.get(n);
            let close = -1;
            if (runs) {
                while (runs.k < runs.pos.length && runs.pos[runs.k] < i + n) runs.k++;
                if (runs.k < runs.pos.length) close = runs.pos[runs.k];
            }
            if (close >= 0) {
                const e = close + n;
                span(model, i, e, 'code');
                mark(model, i, i + n, 'invisible', 'dim', i, e);
                mark(model, close, e, 'invisible', 'dim', i, e);
                model.codeSpans.push({ s: i, e });
                fill(i, e);
                i = e;
            } else {
                // An unmatched backtick string is literal text
                fill(i, i + n);
                i += n;
            }
            continue;
        }
        if (c === 60) { // <
            if (t.startsWith('<!--', i)) {
                // Searches start at increasing positions: reuse the last
                // result while it is still ahead (or there was none)
                if (!(commentFrom >= 0 && commentFrom <= i + 2 && (commentAt < 0 || commentAt >= i + 2))) {
                    commentFrom = i + 2;
                    commentAt = t.indexOf('-->', i + 2);
                }
                const k = commentAt;
                if (k >= 0 && k + 3 <= end) {
                    span(model, i, k + 3, 'comment');
                    fill(i, k + 3);
                    i = k + 3;
                    continue;
                }
            }
            // Both autolink forms start with a letter, digit or email
            // character; skip the regexes for anything else (e.g. "<<<")
            const n = i + 1 < end ? t.charCodeAt(i + 1) : 0;
            let m = null;
            let url = null;
            if (n > 32 && n < 127 && n !== 60 && n !== 62 && n !== 64) {
                AUTOLINK_RE.lastIndex = i;
                m = AUTOLINK_RE.exec(t);
                if (m) {
                    url = m[1];
                } else {
                    EMAIL_AUTOLINK_RE.lastIndex = i;
                    m = EMAIL_AUTOLINK_RE.exec(t);
                    if (m) url = 'mailto:' + m[1];
                }
            }
            if (m && i + m[0].length > end) m = null;
            if (m) {
                const e = i + m[0].length;
                span(model, i + 1, e - 1, 'link');
                mark(model, i, i + 1, 'invisible', 'dim', i, e);
                mark(model, e - 1, e, 'invisible', 'dim', i, e);
                model.links.push({ s: i, e, url });
                fill(i, e);
                i = e;
                continue;
            }
        }
        i++;
    }

    // Pass 2: inline links and images. Link text is [^\]]+ (innermost
    // brackets win) and must be directly followed by "(".
    const linkTexts = [];
    for (i = start; i < end; i++) {
        if (t.charCodeAt(i) !== 91 || excl[i]) continue; // [
        let j = i + 1;
        for (; j < end; j++) {
            const c = t.charCodeAt(j);
            if ((c === 93 || c === 91) && !excl[j]) break; // ] [
        }
        if (j >= end || t[j] !== ']' || j === i + 1) continue;
        if (t[j + 1] !== '(' || excl[j + 1]) continue;
        const tail = parseLinkTail(t, j + 2, end, memo);
        if (!tail) continue;
        const image = i > start && t[i - 1] === '!' && !excl[i - 1];
        const s = image ? i - 1 : i;
        const e = tail.end;
        span(model, i + 1, j, 'link');
        mark(model, s, i + 1, 'invisible', 'dim', s, e);
        mark(model, j, tail.destS, 'invisible', 'dim', s, e);
        mark(model, tail.destS, tail.destE, 'invisible', 'link-url', s, e);
        mark(model, tail.destE, e, 'invisible', 'dim', s, e);
        model.links.push({ s, e, url: tail.url });
        fill(s, i + 1);
        fill(j, e);
        linkTexts.push([i + 1, j]);
        i = e - 1;
    }
    // Link texts are sorted and disjoint; queries come in increasing order
    let ltK = 0;
    const inLinkText = (k) => {
        while (ltK < linkTexts.length && linkTexts[ltK][1] <= k) ltK++;
        return ltK < linkTexts.length && k >= linkTexts[ltK][0];
    };

    // Pass 3: bare URLs (GFM-style trailing punctuation trimming)
    BARE_URL_RE.lastIndex = start;
    let um;
    while ((um = BARE_URL_RE.exec(t)) !== null) {
        const s = um.index;
        if (s >= end) break;
        let e = Math.min(end, s + um[0].length);
        const prev = s > start ? t[s - 1] : ' ';
        if (excl[s] || inLinkText(s) || !(isWhitespace(prev) || '*_~(\'"'.includes(prev)))
            continue;
        for (let k = s; k < e; k++) {
            if (excl[k]) {
                e = k;
                break;
            }
        }
        for (;;) {
            const last = t[e - 1];
            if ('?!.,:*_~\'";'.includes(last)) {
                e--;
            } else if (last === ')') {
                const seg = t.slice(s, e);
                const opens = seg.split('(').length - 1;
                const closes = seg.split(')').length - 1;
                if (closes > opens) e--;
                else break;
            } else {
                break;
            }
        }
        if (e - s <= t.indexOf('://', s) - s + 3) continue;
        span(model, s, e, 'link');
        model.links.push({ s, e, url: t.slice(s, e) });
        fill(s, e);
        BARE_URL_RE.lastIndex = e;
    }

    // Pass 4: emphasis / strong / strikethrough via delimiter runs,
    // processed separately inside each link text and outside of links.
    // First collect the runs cheaply; scopes with more than
    // MAX_DELIM_RUNS runs (pathological lines) are left plain.
    const runs = [];
    const scopeCount = new Map();
    let scK = 0;
    for (i = start; i < end;) {
        const c = t.charCodeAt(i);
        if ((c === 42 || c === 95 || c === 126) && !excl[i]) { // * _ ~
            let k = i + 1;
            while (k < end && t.charCodeAt(k) === c && !excl[k]) k++;
            if (c !== 126 || k - i === 2) {
                while (scK < linkTexts.length && linkTexts[scK][1] <= i) scK++;
                const scope = scK < linkTexts.length && i >= linkTexts[scK][0] ? scK : -1;
                runs.push(i, k, scope);
                scopeCount.set(scope, (scopeCount.get(scope) || 0) + 1);
            }
            i = k;
        } else {
            i++;
        }
    }
    const scopes = new Map();
    for (let r = 0; r < runs.length; r += 3) {
        const pos = runs[r], k = runs[r + 1], scope = runs[r + 2];
        if (scopeCount.get(scope) > MAX_DELIM_RUNS) continue;
        const ch = t[pos];
        const len = k - pos;
        const before = charBefore(t, pos, start);
        const after = charAt(t, k, end);
        const bW = isWhitespace(before), aW = isWhitespace(after);
        const bP = isPunctuation(before), aP = isPunctuation(after);
        const left = !aW && (!aP || bW || bP);
        const right = !bW && (!bP || aW || aP);
        let canOpen, canClose;
        if (ch === '_') {
            canOpen = left && (!right || bP);
            canClose = right && (!left || aP);
        } else {
            canOpen = left;
            canClose = right;
        }
        if (canOpen || canClose) {
            if (!scopes.has(scope)) scopes.set(scope, []);
            scopes.get(scope).push({ ch, pos, len, origLen: len, canOpen, canClose });
        }
    }
    for (const delims of scopes.values()) processEmphasis(delims, model);

    // Pass 5: arrows (visual only; drawn by the text view)
    for (i = start; i < end - 1; i++) {
        if (excl[i] || excl[i + 1]) continue;
        const a = t[i], b = t[i + 1];
        let len = 0;
        if (a === '<' && b === '-' && i + 2 < end && t[i + 2] === '>' && !excl[i + 2]) len = 3;
        else if ((a === '-' && b === '>') || (a === '<' && b === '-')) len = 2;
        if (len) {
            mark(model, i, i + len, 'arrow', null, i, i + len);
            i += len - 1;
        }
    }
}

// Maximal backtick runs in t[from, end), grouped by length
function backtickRuns(t, from, end) {
    const byLen = new Map();
    let i = t.indexOf('`', from);
    while (i >= 0 && i < end) {
        let n = 1;
        while (i + n < end && t.charCodeAt(i + n) === 96) n++;
        let entry = byLen.get(n);
        if (!entry) {
            entry = { pos: [], k: 0 };
            byLen.set(n, entry);
        }
        entry.pos.push(i);
        i = t.indexOf('`', i + n);
    }
    return byLen;
}

function processEmphasis(delims, model) {
    let c = 0;
    while (c < delims.length) {
        const closer = delims[c];
        if (!closer.canClose || closer.len === 0) {
            c++;
            continue;
        }
        let found = -1;
        for (let o = c - 1; o >= 0; o--) {
            const op = delims[o];
            if (op.ch !== closer.ch || !op.canOpen || op.len === 0) continue;
            if (op.ch === '~') {
                if (op.len !== closer.len) continue;
            } else if ((op.canClose || closer.canOpen) &&
                (op.origLen + closer.origLen) % 3 === 0 &&
                !(op.origLen % 3 === 0 && closer.origLen % 3 === 0)) {
                continue;
            }
            found = o;
            break;
        }
        if (found < 0) {
            c++;
            continue;
        }
        const op = delims[found];
        const use = closer.ch === '~' ? 2 : (closer.len >= 2 && op.len >= 2 ? 2 : 1);
        const oS = op.pos + op.len - use;
        const oE = op.pos + op.len;
        const cS = closer.pos;
        const cE = closer.pos + use;
        const tag = closer.ch === '~' ? 'strikethrough' : (use === 2 ? 'bold' : 'italic');
        span(model, oS, cE, tag);
        mark(model, oS, oE, 'invisible', 'dim', oS, cE);
        mark(model, cS, cE, 'invisible', 'dim', oS, cE);
        op.len -= use;
        closer.pos += use;
        closer.len -= use;
        for (let k = found + 1; k < c; k++) delims[k].len = 0;
        if (closer.len === 0) c++;
    }
}

// Parse the block prefix of a TEXT line (quote markers, list marker, task
// box). Uses the same detector as the editing commands (Ctrl+T, Enter,
// double-click), so everything rendered as a task can be toggled.
function parseTextLine(t, model) {
    const pre = MarkdownList.parseLinePrefix(t);
    if (!pre) {
        parseInline(t, 0, t.length, model);
        return;
    }
    const p = pre.quote ? pre.quote.end : 0;
    if (pre.quote) {
        for (let k = 0; k < p; k++) {
            if (t[k] === '>') span(model, k, k + 1, 'quote-marker');
        }
        model.quote = { depth: pre.quote.depth };
        span(model, p, t.length, 'blockquote');
    }

    let q = p;
    const item = pre.item;
    if (item) {
        const s = item.markerStart;
        if (item.ordered) {
            model.list = { type: 'ordered', s, e: item.markerEnd };
            span(model, s, item.markerEnd, 'numbered-list-number');
        } else {
            const type = item.bullet === '*' ? 'star' : (item.bullet === '-' ? 'dash' : 'plus');
            model.list = { type, s, e: s + 1 };
            if (type === 'star') mark(model, s, s + 1, 'bullet-star', 'bullet-star-near', s, s + 1);
            else span(model, s, s + 1, 'bullet-dash');
        }
        q = item.markerEnd + item.spacing.length;
    }

    let box = -1;
    if (pre.checkbox) {
        box = pre.checkbox.index;
        const checked = pre.checkbox.checked;
        model.task = { s: box, checked };
        const off = checked ? 'todo-checked' : 'todo-unchecked';
        const on = checked ? 'todo-checked-inside' : 'todo-unchecked-inside';
        mark(model, box, box + 3, off, on, box, box + 3);
        mark(model, box, box + 1, 'invisible', 'dim', box, box + 3);
        mark(model, box + 1, box + 2, null, 'dim', box, box + 3);
        mark(model, box + 2, box + 3, 'invisible', 'dim', box, box + 3);
        q = box + 3;
        if (checked) span(model, pre.contentStart, t.length, 'todo-checked-text');
    }

    if (model.list || model.task) {
        const end = pre.contentStart;
        model.prefix = { text: t.slice(0, end), end, box };
        span(model, 0, t.length, 'list-item');
    } else {
        model.prefix = { text: t.slice(0, p), end: p, box };
    }

    parseInline(t, q, t.length, model);
}

// Convert all UTF-16 offsets in the model to code point columns
function toCodePoints(t, model) {
    if (!/[\uD800-\uDBFF]/.test(t)) return model;
    const map = new Int32Array(t.length + 1);
    let cp = 0;
    for (let i = 0; i < t.length; i++) {
        map[i] = cp;
        const c = t.charCodeAt(i);
        if (c >= 0xD800 && c <= 0xDBFF && i + 1 < t.length) {
            map[i + 1] = cp;
            i++;
        }
        cp++;
    }
    map[t.length] = cp;
    const conv = (v) => (v >= 0 && v <= t.length ? map[v] : v);
    for (const s of model.spans) {
        s.s = conv(s.s);
        s.e = conv(s.e);
    }
    for (const mk of model.marks) {
        mk.s = conv(mk.s);
        mk.e = conv(mk.e);
        mk.gs = conv(mk.gs);
        mk.ge = conv(mk.ge);
    }
    for (const l of model.links) {
        l.s = conv(l.s);
        l.e = conv(l.e);
    }
    for (const c of model.codeSpans) {
        c.s = conv(c.s);
        c.e = conv(c.e);
    }
    if (model.heading) {
        model.heading.contentStart = conv(model.heading.contentStart);
        model.heading.contentEnd = conv(model.heading.contentEnd);
    }
    if (model.list) {
        model.list.s = conv(model.list.s);
        model.list.e = conv(model.list.e);
    }
    if (model.task) model.task.s = conv(model.task.s);
    // prefix.text/box stay in UTF-16 (the prefix is ASCII); end is a column
    if (model.prefix) model.prefix.end = conv(model.prefix.end);
    return model;
}

// Parse one line. fenceIn is the block state left by the previous line.
function parseLine(text, fenceIn = '') {
    const cls = classifyLine(text, fenceIn);
    const model = newModel(cls.kind, cls.fenceOut);

    switch (cls.kind) {
    case Kind.HEADING: {
        const m = HEADING_RE.exec(text);
        const level = m[2].length;
        const contentStart = m[0].length;
        const hc = headingContent(text, contentStart);
        model.heading = { level, contentStart, contentEnd: hc.contentEnd };
        const dimTag = `dim-h${level}`;
        mark(model, 0, contentStart, 'invisible', dimTag, 0, LINE_GROUP_END);
        if (hc.closeStart >= 0)
            mark(model, hc.closeStart, text.length, 'invisible', dimTag, 0, LINE_GROUP_END);
        parseInline(text, contentStart, hc.contentEnd, model);
        break;
    }
    case Kind.HR: {
        let s = 0;
        while (text[s] === ' ' || text[s] === '\t') s++;
        let e = text.length;
        while (e > s && (text[e - 1] === ' ' || text[e - 1] === '\t')) e--;
        mark(model, s, e, 'hr-line', 'hr-line-dim', 0, LINE_GROUP_END);
        break;
    }
    case Kind.TEXT:
        parseTextLine(text, model);
        break;
    case Kind.HTML:
        span(model, 0, text.length, 'comment');
        break;
    default:
        break;
    }
    return toCodePoints(text, model);
}

// Classify a whole document (array of line strings); returns kinds and the
// fence state after each line. Used by tests and initial renders.
function classifyLines(lines) {
    const kinds = new Array(lines.length);
    const fenceOut = new Array(lines.length);
    let state = '';
    for (let i = 0; i < lines.length; i++) {
        const c = classifyLine(lines[i], state);
        kinds[i] = c.kind;
        fenceOut[i] = c.fenceOut;
        state = c.fenceOut;
    }
    return { kinds, fenceOut };
}

// Split text into lines the way GtkTextBuffer does (\n, \r\n, \r, U+2029)
function splitLines(text) {
    return text.split(LINE_SPLIT_RE);
}
