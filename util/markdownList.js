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
    sameListType,
    indentWidth,
    leadingWhitespace,
    parseHeader,
};
