const { Gio, GLib } = imports.gi;

// ============================================================================
// Settings Manager
// ============================================================================
//
// settings.json lives in $XDG_CONFIG_HOME/jotite (default ~/.config/jotite).
// The file is JSON with optional // and /* */ comments and trailing commas.
// If the file cannot be parsed, the last successfully parsed settings stay in
// effect (also across restarts, via a cached copy in
// $XDG_STATE_HOME/jotite/settings.last-good.json) and `error` describes the
// problem so the UI can show it.

var DEFAULT_MOODS = [
    'metal', 'cobalt', 'fire', 'forest', 'lava', 'mint',
    'amber', 'ocean', 'solar', 'cryo', 'stone', 'ice',
    'purple', 'sunset', 'royal', 'aurora', 'sunken', 'ghost',
    'sulfur', 'velvet', 'cicada', 'lunar', 'tonic', 'ectoplasm',
    'polar', 'chiaroscuro', 'vanta', 'toxicvelvet', 'bruise',
    'bismuth', 'ultralich', 'paradox', 'hazmat', 'feral',
];

function getDefaultSettings() {
    return {
        notesPath: '~/Documents/Jotite',
        autosave: true,
        headerMoods: DEFAULT_MOODS.slice(),
        customMoods: {},
    };
}

// Remove // and /* */ comments and trailing commas, leaving string literals
// (which may contain "//", e.g. URLs) untouched.
function stripJsonComments(text) {
    let out = '';
    let i = 0;
    const n = text.length;
    while (i < n) {
        const c = text[i];
        if (c === '"') {
            let j = i + 1;
            while (j < n && text[j] !== '"') {
                if (text[j] === '\\') j++;
                j++;
            }
            out += text.slice(i, j + 1);
            i = j + 1;
        } else if (c === '/' && text[i + 1] === '/') {
            while (i < n && text[i] !== '\n') i++;
        } else if (c === '/' && text[i + 1] === '*') {
            const end = text.indexOf('*/', i + 2);
            i = end === -1 ? n : end + 2;
        } else if (c === ',') {
            // Drop a trailing comma before } or ] (skipping whitespace/comments
            // is handled because comments were already removed before it).
            let j = i + 1;
            while (j < n && /\s/.test(text[j])) j++;
            if (text[j] === '}' || text[j] === ']') {
                i++;
            } else {
                out += c;
                i++;
            }
        } else {
            out += c;
            i++;
        }
    }
    return out;
}

// Parse settings text. Returns the merged settings object or throws with a
// readable message.
function parseSettings(text) {
    let parsed;
    try {
        // Two passes so a comment between a trailing comma and the closing
        // bracket does not hide the comma.
        parsed = JSON.parse(stripJsonComments(stripJsonComments(text)));
    } catch (e) {
        throw new Error(`settings.json is not valid JSON: ${e.message}`);
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
        throw new Error('settings.json must contain a JSON object');
    return Object.assign(getDefaultSettings(), parsed);
}

function _getAppDirectory() {
    let appDir = GLib.path_get_dirname(imports.system.programPath);
    // When installed, the launcher lives in /usr/bin and data in /usr/share/jotite
    if (appDir === '/usr/bin' || appDir === '/usr/local/bin') {
        const dataDir = appDir === '/usr/bin' ? '/usr/share/jotite' : '/usr/local/share/jotite';
        if (GLib.file_test(dataDir, GLib.FileTest.IS_DIR))
            return dataDir;
    }
    return appDir;
}

var SettingsManager = class SettingsManager {
    // options: { configDir, stateDir } (for tests)
    constructor(options = {}) {
        this._configDir = options.configDir || GLib.build_filenamev([GLib.get_user_config_dir(), 'jotite']);
        this._stateDir = options.stateDir || GLib.build_filenamev([GLib.get_user_state_dir(), 'jotite']);
        this.error = null;
        this.monitor = null;
        this._monitorHandler = 0;
        this._reloadSourceId = 0;
        this.settings = null;
        this._load(true);
    }

    get configDir() {
        return this._configDir;
    }

    get settingsPath() {
        return GLib.build_filenamev([this._configDir, 'settings.json']);
    }

    get _lastGoodPath() {
        return GLib.build_filenamev([this._stateDir, 'settings.last-good.json']);
    }

    // Create the config directory, seeding settings.json and FAQ.md from the
    // application directory on first use. Returns the config directory.
    _ensureConfigDirectory() {
        if (!GLib.file_test(this._configDir, GLib.FileTest.IS_DIR)) {
            GLib.mkdir_with_parents(this._configDir, 0o755);
        }
        const appDir = _getAppDirectory();
        for (const name of ['settings.json', 'FAQ.md']) {
            const dst = Gio.File.new_for_path(GLib.build_filenamev([this._configDir, name]));
            if (dst.query_exists(null))
                continue;
            const src = Gio.File.new_for_path(GLib.build_filenamev([appDir, name]));
            try {
                if (src.query_exists(null))
                    src.copy(dst, Gio.FileCopyFlags.NONE, null, null);
                else if (name === 'settings.json')
                    dst.replace_contents(new TextEncoder().encode(
                        `${JSON.stringify(getDefaultSettings(), null, 2)}\n`), null, false,
                    Gio.FileCreateFlags.NONE, null);
            } catch (e) {
                logError(e, `Jotite: could not create ${dst.get_path()}`);
            }
        }
        return this._configDir;
    }

    _readLastGood() {
        try {
            const [, bytes] = GLib.file_get_contents(this._lastGoodPath);
            return parseSettings(new TextDecoder().decode(bytes));
        } catch (e) {
            return null;
        }
    }

    _writeLastGood(text) {
        try {
            GLib.mkdir_with_parents(this._stateDir, 0o700);
            GLib.file_set_contents(this._lastGoodPath, text);
        } catch (e) {
            // Best effort only
        }
    }

    // (Re)load settings.json. On a parse error the previous settings (or the
    // cached last-good copy at startup) are kept and `error` is set.
    _load(initial = false) {
        let text = null;
        try {
            const [, bytes] = GLib.file_get_contents(this.settingsPath);
            text = new TextDecoder().decode(bytes);
        } catch (e) {
            if (!e.matches?.(GLib.FileError, GLib.FileError.NOENT)) {
                this.error = `Could not read settings.json: ${e.message}`;
                if (initial)
                    this.settings = this._readLastGood() || getDefaultSettings();
                return false;
            }
        }

        if (text === null) {
            this.error = null;
            this.settings = getDefaultSettings();
            return true;
        }

        try {
            const settings = parseSettings(text);
            this.settings = settings;
            this.error = null;
            if (initial || text !== this._lastGoodText)
                this._writeLastGood(text);
            this._lastGoodText = text;
            return true;
        } catch (e) {
            this.error = `${e.message} — keeping previous settings`;
            if (initial || !this.settings)
                this.settings = this._readLastGood() || getDefaultSettings();
            return false;
        }
    }

    reload() {
        return this._load(false);
    }

    // Watch settings.json; callback() runs (debounced) after each change.
    setupMonitor(callback) {
        if (this.monitor)
            return;
        try {
            this._ensureConfigDirectory();
            const file = Gio.File.new_for_path(this.settingsPath);
            this.monitor = file.monitor_file(Gio.FileMonitorFlags.WATCH_MOVES, null);
            this._monitorHandler = this.monitor.connect('changed', () => {
                if (this._reloadSourceId)
                    GLib.source_remove(this._reloadSourceId);
                this._reloadSourceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 150, () => {
                    this._reloadSourceId = 0;
                    this._load(false);
                    callback();
                    return GLib.SOURCE_REMOVE;
                });
            });
        } catch (e) {
            logError(e, 'Jotite: failed to watch settings.json');
        }
    }

    destroy() {
        if (this._reloadSourceId) {
            GLib.source_remove(this._reloadSourceId);
            this._reloadSourceId = 0;
        }
        if (this.monitor) {
            if (this._monitorHandler)
                this.monitor.disconnect(this._monitorHandler);
            this.monitor.cancel();
            this.monitor = null;
        }
    }

    get(key) {
        return this.settings[key];
    }
};

SettingsManager.getDefaultSettings = getDefaultSettings;
SettingsManager.parseSettings = parseSettings;
SettingsManager.stripJsonComments = stripJsonComments;
