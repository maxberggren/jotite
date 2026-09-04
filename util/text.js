// ============================================================================
// Text Utilities
// ============================================================================

var TextUtils = {
    // Length of a string in Unicode code points, which is how GtkTextBuffer
    // counts offsets. String.length counts UTF-16 code units, so characters
    // outside the BMP (most emoji) would otherwise be counted twice.
    charLength(str) {
        let count = 0;
        for (let i = 0; i < str.length; i++) {
            const code = str.charCodeAt(i);
            if (code >= 0xD800 && code <= 0xDBFF) {
                i++; // skip the low surrogate
            }
            count++;
        }
        return count;
    },
    
    // UTF-16 index in str of the character at code point offset charOffset
    // (the inverse of charLength for a prefix of the string).
    indexAt(str, charOffset) {
        let i = 0;
        for (let n = 0; n < charOffset && i < str.length; n++) {
            const code = str.charCodeAt(i);
            i += (code >= 0xD800 && code <= 0xDBFF) ? 2 : 1;
        }
        return i;
    },
};
