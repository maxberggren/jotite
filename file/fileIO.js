const { Gio, GLib } = imports.gi;

// ============================================================================
// Byte-preserving text file I/O
// ============================================================================
//
// The editor buffer works without a BOM and, for files that use CRLF
// throughout, with '\n' line endings. A file's on-disk "format" (BOM, CRLF)
// is detected on load and re-applied on save; files with mixed line endings
// keep them verbatim in the buffer. Opening and saving reproduces a file byte
// for byte, and an edit only changes the edited lines. Files that are not valid UTF-8 (or contain NUL bytes) are
// refused instead of being silently "repaired" with U+FFFD.

const BOM = [0xEF, 0xBB, 0xBF];

var EncodingError = class EncodingError extends Error {
    constructor(message) {
        super(message);
        this.name = 'EncodingError';
    }
};

function _hasBom(bytes) {
    return bytes.length >= 3 && bytes[0] === BOM[0] && bytes[1] === BOM[1] && bytes[2] === BOM[2];
}

// Decode raw file bytes into { text, format }. Throws EncodingError for
// content Jotite cannot edit losslessly.
function decode(bytes) {
    if (!(bytes instanceof Uint8Array))
        bytes = new Uint8Array(bytes);
    const bom = _hasBom(bytes);
    const body = bom ? bytes.subarray(3) : bytes;

    if (body.indexOf(0) !== -1)
        throw new EncodingError('File contains NUL bytes (binary file?) and cannot be edited');

    let text;
    try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(body);
    } catch (e) {
        throw new EncodingError(`File is not valid UTF-8 and cannot be edited safely (${e.message})`);
    }

    // Line endings: a file whose every line ending is CRLF is edited with
    // '\n' and CRLF is re-emitted on save. Anything else (LF, mixed, lone
    // CR) stays exactly as it is in the buffer (GtkTextBuffer understands
    // all of them as line breaks), so saving never rewrites the endings of
    // lines that were not edited.
    let crlf = 0, other = 0;
    for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) {
        if (i > 0 && text.charCodeAt(i - 1) === 13) crlf++;
        else other++;
    }
    const cr = text.split('\r').length - 1;
    const eol = crlf > 0 && other === 0 && cr === crlf ? '\r\n' : '\n';
    if (eol === '\r\n')
        text = text.replace(/\r\n/g, '\n');

    return { text, format: { bom, eol } };
}

// Encode buffer text (with '\n' line endings) for writing in `format`.
function encode(text, format = null) {
    const bom = format?.bom ?? false;
    const eol = format?.eol ?? '\n';
    if (eol !== '\n')
        text = text.replace(/\r?\n/g, eol);
    const body = new TextEncoder().encode(text);
    if (!bom)
        return body;
    const out = new Uint8Array(body.length + 3);
    out.set(BOM, 0);
    out.set(body, 3);
    return out;
}

function queryEtag(file) {
    try {
        return file.query_info('etag::value', Gio.FileQueryInfoFlags.NONE, null).get_etag();
    } catch (e) {
        if (e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND))
            return null;
        throw e;
    }
}

// Read a file. Returns { exists, text, format, etag }. A missing file is not
// an error: it yields an empty document bound to that path (created on the
// first save). Other errors (permissions, directories, encoding) throw with a
// user-presentable message.
function readFile(file) {
    let info;
    try {
        info = file.query_info('standard::type,etag::value', Gio.FileQueryInfoFlags.NONE, null);
    } catch (e) {
        if (e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND))
            return { exists: false, text: '', format: { bom: false, eol: '\n' }, etag: null };
        throw e;
    }
    if (info.get_file_type() === Gio.FileType.DIRECTORY)
        throw new Error(`${file.get_path() ?? file.get_uri()} is a directory`);

    const [, contents, etag] = file.load_contents(null);
    const { text, format } = decode(contents);
    return { exists: true, text, format, etag: etag || info.get_etag() };
}

// Atomically write text to file (temp file + rename, done by GIO for local
// files; permissions and symlinks are preserved). If expectedEtag is given
// and the file changed on disk since, throws a Gio WRONG_ETAG error.
// Missing parent directories are created. Returns the new etag.
function writeFile(file, text, format, expectedEtag = null) {
    const parent = file.get_parent();
    if (parent && !parent.query_exists(null)) {
        try {
            parent.make_directory_with_parents(null);
        } catch (e) {
            if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.EXISTS))
                throw e;
        }
    }
    const bytes = encode(text, format);
    const stream = file.replace(expectedEtag, false, Gio.FileCreateFlags.NONE, null);
    try {
        if (bytes.length > 0)
            stream.write_all(bytes, null);
        stream.close(null);
    } catch (e) {
        // Closing with a cancelled cancellable discards the temp file, so the
        // original stays intact
        try {
            const cancelled = new Gio.Cancellable();
            cancelled.cancel();
            stream.close(cancelled);
        } catch (_) {
            // ignore
        }
        throw e;
    }
    return stream.get_etag() || queryEtag(file);
}

function isWrongEtag(e) {
    return !!e?.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.WRONG_ETAG);
}

// Human-readable message for a GError / Error.
function describeError(e) {
    return (e && e.message) ? e.message : String(e);
}

var FileIO = { decode, encode, readFile, writeFile, queryEtag, isWrongEtag, describeError, EncodingError };
