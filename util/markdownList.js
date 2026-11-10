// ============================================================================
// Markdown list-item parsing (pure functions, no Gtk)
// ============================================================================
//
// A list item marker is CommonMark-ish:
//   bullet:  [-*+] followed by a space/tab or end of line
//   ordered: 1–9 digits, then '.' or ')', followed by a space/tab or end of line
// so `*bold* text`, `3.14 is pi` and `-1 degrees` are NOT list items.
// All indices returned are UTF-16 string indices into the given line.

const ITEM_RE = /^([ \t]*)(?:([-*+])|(\d{1,9})([.)]))([ \t]+|$)/;
const THEMATIC_BREAK_RE = /^[ \t]*([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const CHECKBOX_RE = /^\[([ xX])\](?=[ \t]|$)/;

// Visual width of leading whitespace (tabs advance to the next multiple of 4).
function indentWidth(ws) {
    let col = 0;
    for (const ch of ws) {
        if (ch === '\t')
            col += 4 - (col % 4);
        else
            col += 1;
    }
    return col;
}

function leadingWhitespace(line) {
    return /^[ \t]*/.exec(line)[0];
}

// Parse a single line (without terminator; a trailing '\r' is tolerated).
// Returns null when the line is not a list item.
function parseListItem(rawLine) {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    if (THEMATIC_BREAK_RE.test(line))
        return null;
    const m = ITEM_RE.exec(line);
    if (!m)
        return null;

    const [whole, indent, bullet, digits, delimiter, spacing] = m;
    const ordered = digits !== undefined;
    const marker = ordered ? digits + delimiter : bullet;
    const markerStart = indent.length;
    const markerEnd = markerStart + marker.length;
    const iw = indentWidth(indent);

    // CommonMark: 1–4 spaces after the marker belong to it; with 5+ (or none)
    // the content column is marker + 1.
    const spacingWidth = spacing.length >= 1 && spacing.length <= 4 ? spacing.length : 1;
    const contentColumn = iw + marker.length + spacingWidth;

    let contentStart = whole.length;
    let checkbox = null;
    if (spacing.length > 0) {
        const cb = CHECKBOX_RE.exec(line.slice(contentStart));
        if (cb) {
            checkbox = {
                index: contentStart,
                char: cb[1],
                checked: cb[1] !== ' ',
            };
            contentStart += 3;
            contentStart += /^[ \t]*/.exec(line.slice(contentStart))[0].length;
        }
    }

    return {
        indent,
        indentWidth: iw,
        ordered,
        bullet: ordered ? null : bullet,
        number: ordered ? parseInt(digits, 10) : null,
        digits: ordered ? digits : null,
        delimiter: ordered ? delimiter : null,
        marker,
        markerStart,
        markerEnd,
        spacing,
        contentColumn,
        checkbox,
        contentStart,
        content: line.slice(contentStart),
    };
}

// Block quote markers at the start of a line ("> ", "> > ", up to three
// spaces before each '>', one optional space after it).
const QUOTE_RE = /^(?: {0,3}>[ \t]?)+/;

// The one task/list detector shared by the renderer and every editing
// command (Ctrl+T, double-click, Enter), so whatever renders as a task can
// be toggled and continued. Recognises, after optional block quote markers:
//   - list items (see parseListItem), optionally with a task box: "- [ ] x"
//   - bare task boxes at the start of the (quoted) line: "[ ] x", "  [x] y"
// Returns null when the line has none of quote, list item or task box,
// otherwise:
//   quote:    { end, depth } or null (end = index after the quote markers)
//   item:     parseListItem() result for the text after the quote, with
//             every index (markerStart, markerEnd, contentStart,
//             checkbox.index) relative to the whole line, or null
//   checkbox: { index, char, checked } (whole-line index) or null
//   lead:     text before the list marker / bare box (quote + indentation)
//   contentStart, content: where the item's text begins
// All indices are UTF-16 indices into the line; a trailing '\r' is ignored.
function parseLinePrefix(rawLine) {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    let p = 0;
    let quote = null;
    const qm = QUOTE_RE.exec(line);
    if (qm) {
        p = qm[0].length;
        let depth = 0;
        for (let k = 0; k < p; k++) {
            if (line[k] === '>')
                depth++;
        }
        quote = { end: p, depth };
    }

    const rest = p > 0 ? line.slice(p) : line;
    let item = parseListItem(rest);
    let checkbox = null;
    let lead;
    let contentStart;
    if (item) {
        if (p > 0) {
            item.markerStart += p;
            item.markerEnd += p;
            item.contentStart += p;
            if (item.checkbox)
                item.checkbox.index += p;
        }
        checkbox = item.checkbox;
        lead = line.slice(0, item.markerStart);
        contentStart = item.contentStart;
    } else {
        // Bare task box: "[ ] text" after optional indentation
        const ws = leadingWhitespace(rest).length;
        const cb = CHECKBOX_RE.exec(rest.slice(ws));
        if (cb) {
            checkbox = { index: p + ws, char: cb[1], checked: cb[1] !== ' ' };
            contentStart = checkbox.index + 3;
            contentStart += leadingWhitespace(line.slice(contentStart)).length;
        } else if (!quote) {
            return null;
        } else {
            contentStart = p;
        }
        lead = line.slice(0, checkbox ? checkbox.index : p);
    }
    return { quote, item, checkbox, lead, contentStart, content: line.slice(contentStart) };
}

// Is `b` the same kind of list as `a` (same bullet char / same delimiter)?
function sameListType(a, b) {
    if (a.ordered !== b.ordered)
        return false;
    return a.ordered ? a.delimiter === b.delimiter : a.bullet === b.bullet;
}

// ATX header: returns { hashes, rest } or null.
function parseHeader(rawLine) {
    const m = /^(#{1,6})([ \t]+\S.*|[ \t]*)$/.exec(rawLine.replace(/\r$/, ''));
    if (!m)
        return null;
    return { hashes: m[1], rest: m[2] };
}

var MarkdownList = {
    parseListItem,
    parseLinePrefix,
    sameListType,
    indentWidth,
    leadingWhitespace,
    parseHeader,
};
