// ============================================================================
// Text Utilities
// ============================================================================
//
// GtkTextBuffer offsets (get_offset, get_line_offset, get_iter_at_offset…)
// count Unicode code points. JS strings are indexed in UTF-16 code units, so
// any character outside the BMP (most emoji) is one buffer offset but two
// string indices. Every conversion between the two goes through here.

function _isHighSurrogate(code) {
    return code >= 0xD800 && code <= 0xDBFF;
}

function _isLowSurrogate(code) {
    return code >= 0xDC00 && code <= 0xDFFF;
}

var TextUtils = {
    // Length of a string in Unicode code points (buffer offset units).
    charLength(str) {
        let count = 0;
        for (let i = 0; i < str.length; i++) {
            if (_isHighSurrogate(str.charCodeAt(i)) && i + 1 < str.length &&
                _isLowSurrogate(str.charCodeAt(i + 1)))
                i++;
            count++;
        }
        return count;
    },

    // UTF-16 index in str of the code point at code point offset charOffset.
    // Clamped to str.length.
    indexAt(str, charOffset) {
        let i = 0;
        for (let n = 0; n < charOffset && i < str.length; n++) {
            if (_isHighSurrogate(str.charCodeAt(i)) && i + 1 < str.length &&
                _isLowSurrogate(str.charCodeAt(i + 1)))
                i += 2;
            else
                i += 1;
        }
        return i;
    },

    // Code point offset of UTF-16 index `index` in str (inverse of indexAt).
    // An index pointing at the low half of a surrogate pair is rounded down
    // to the start of that character.
    offsetAt(str, index) {
        return this.offsetsAt(str, [Math.max(0, index)])[0];
    },

    // Convert an ascending array of UTF-16 indices into code point offsets in
    // a single O(str.length) pass. Used to convert many search matches.
    offsetsAt(str, sortedIndices) {
        const out = new Array(sortedIndices.length);
        let i = 0;
        let cp = 0;
        for (let k = 0; k < sortedIndices.length; k++) {
            const target = sortedIndices[k];
            while (i < target && i < str.length) {
                if (_isHighSurrogate(str.charCodeAt(i)) && i + 1 < str.length &&
                    _isLowSurrogate(str.charCodeAt(i + 1))) {
                    if (i + 1 >= target)
                        break; // target is inside a pair: round down
                    i += 2;
                } else {
                    i += 1;
                }
                cp++;
            }
            out[k] = cp;
        }
        return out;
    },

    // [start, end] iterators of a buffer line, excluding the line terminator.
    lineBounds(buffer, lineNumber) {
        const start = this._iterAtLine(buffer, lineNumber);
        const end = start.copy();
        if (!end.ends_line())
            end.forward_to_line_end();
        return [start, end];
    },

    // Text of one buffer line without its terminator, read via iterators
    // (never the whole buffer).
    lineText(buffer, lineNumber) {
        const [start, end] = this.lineBounds(buffer, lineNumber);
        return buffer.get_text(start, end, true);
    },

    // Iterator at code point offset `offset` within line `lineNumber`.
    iterAtLineOffset(buffer, lineNumber, offset) {
        const iter = this._iterAtLine(buffer, lineNumber);
        const end = iter.copy();
        if (!end.ends_line())
            end.forward_to_line_end();
        iter.set_line_offset(Math.min(offset, end.get_line_offset()));
        return iter;
    },

    _iterAtLine(buffer, lineNumber) {
        const result = buffer.get_iter_at_line(lineNumber);
        // GTK 4 returns [ok, iter]; older bindings return the iter directly.
        return Array.isArray(result) ? result[1] : result;
    },
};
