const { GLib, Gio } = imports.gi;
const { Constants } = imports.constants;

// ============================================================================
// File Manager: notes directory and filename helpers
// ============================================================================

const MAX_SLUG_CHARS = 64;

// Expand ~ and make relative paths relative to $HOME.
function expandPath(path, homeDir = GLib.get_home_dir()) {
    if (!path)
        return null;
    if (path === '~')
        return homeDir;
    if (path.startsWith('~/'))
        return GLib.build_filenamev([homeDir, path.substring(2)]);
    if (!GLib.path_is_absolute(path))
        return GLib.build_filenamev([homeDir, path]);
    return path;
}

var FileManager = class FileManager {
    // The notes directory from the `notesPath` setting (default ~/Documents/Jotite).
    // Never creates it; see ensureJotDirectoryExists.
    static getJotDirectory(settingsManager = null) {
        const notesPath = settingsManager ? settingsManager.get('notesPath') : null;
        if (typeof notesPath === 'string' && notesPath.trim())
            return expandPath(notesPath.trim());
        return GLib.build_filenamev([GLib.get_home_dir(), ...Constants.JOT_DIR]);
    }

    static ensureJotDirectoryExists(settingsManager = null) {
        const jotDir = this.getJotDirectory(settingsManager);
        try {
            Gio.File.new_for_path(jotDir).make_directory_with_parents(null);
        } catch (e) {
            if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.EXISTS))
                throw e;
        }
        return jotDir;
    }

    // Turn a note title into a filename stem. Keeps Unicode letters, marks and
    // digits ("Måndag möte" -> "måndag-möte"); drops punctuation and
    // characters that are unsafe in filenames; whitespace becomes '-'.
    static normalizeFilename(title) {
        if (!title)
            return '';
        let s = String(title).normalize('NFC').trim().toLowerCase()
            .replace(/\s+/gu, '-')
            .replace(/[^\p{L}\p{M}\p{N}_.-]+/gu, '')
            .replace(/-{2,}/g, '-')
            .replace(/^[-.]+|[-.]+$/g, '');
        const chars = Array.from(s);
        if (chars.length > MAX_SLUG_CHARS)
            s = chars.slice(0, MAX_SLUG_CHARS).join('').replace(/[-.]+$/g, '');
        return s;
    }

    static generateFilename(title) {
        const normalized = this.normalizeFilename(title);
        if (normalized)
            return `${normalized}.md`;
        return `${GLib.DateTime.new_now_local().format('%Y-%m-%d')}.md`;
    }

    // A filename in `dir` that does not collide with an existing file:
    // name.md, name-2.md, name-3.md, ...
    static uniqueFilename(dir, filename) {
        const dot = filename.lastIndexOf('.');
        const stem = dot > 0 ? filename.slice(0, dot) : filename;
        const ext = dot > 0 ? filename.slice(dot) : '';
        let candidate = filename;
        for (let n = 2; Gio.File.new_for_path(GLib.build_filenamev([dir, candidate])).query_exists(null); n++)
            candidate = `${stem}-${n}${ext}`;
        return candidate;
    }

    // Path of today's note (YYYY-MM-DD.md in the notes directory).
    static todayNotePath(settingsManager = null) {
        const today = GLib.DateTime.new_now_local().format('%Y-%m-%d');
        return GLib.build_filenamev([this.getJotDirectory(settingsManager), `${today}.md`]);
    }
};

FileManager.expandPath = expandPath;
