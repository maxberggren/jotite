const { Gio, GLib } = imports.gi;

// ============================================================================
// Settings Manager
// ============================================================================

var SettingsManager = class SettingsManager {
    constructor() {
        this.settings = this._loadSettings();
        this.monitor = null;
    }

    _getAppDirectory() {
        // Try to find the application directory (where the script is installed)
        let appDir = null;
        
        if (imports.system.programInvocationName) {
            const invocationPath = imports.system.programInvocationName;
            if (invocationPath.startsWith('./') || invocationPath.startsWith('/')) {
                appDir = GLib.path_get_dirname(GLib.canonicalize_filename(invocationPath, GLib.get_current_dir()));
            }
        }
        if (!appDir) {
            appDir = GLib.path_get_dirname(imports.system.programPath);
        }
        
        // If installed to /usr/bin or /usr/local/bin, look for data files in /usr/share/jotite
        if (appDir === '/usr/bin' || appDir === '/usr/local/bin') {
            const systemDataDir = appDir === '/usr/bin' ? '/usr/share/jotite' : '/usr/local/share/jotite';
            const systemDataDirFile = Gio.File.new_for_path(systemDataDir);
            if (systemDataDirFile.query_exists(null)) {
                return systemDataDir;
            }
        }
        
        return appDir;
    }

    _ensureConfigDirectory() {
        const configDir = GLib.build_filenamev([GLib.get_home_dir(), '.config', 'jotite']);
        const configDirFile = Gio.File.new_for_path(configDir);
        
        if (!configDirFile.query_exists(null)) {
            try {
                configDirFile.make_directory_with_parents(null);
                
                // Copy default files from app directory
                const appDir = this._getAppDirectory();
                
                // Copy settings.json
                const srcSettingsPath = GLib.build_filenamev([appDir, 'settings.json']);
                const srcSettingsFile = Gio.File.new_for_path(srcSettingsPath);
                const dstSettingsPath = GLib.build_filenamev([configDir, 'settings.json']);
                const dstSettingsFile = Gio.File.new_for_path(dstSettingsPath);
                
                if (srcSettingsFile.query_exists(null)) {
                    srcSettingsFile.copy(dstSettingsFile, Gio.FileCopyFlags.NONE, null, null);
                }
                
                // Copy FAQ.md
                const srcFaqPath = GLib.build_filenamev([appDir, 'FAQ.md']);
                const srcFaqFile = Gio.File.new_for_path(srcFaqPath);
                const dstFaqPath = GLib.build_filenamev([configDir, 'FAQ.md']);
                const dstFaqFile = Gio.File.new_for_path(dstFaqPath);
                
                if (srcFaqFile.query_exists(null)) {
                    srcFaqFile.copy(dstFaqFile, Gio.FileCopyFlags.NONE, null, null);
                }
            } catch (e) {
                print(`Warning: Error setting up config directory: ${e.message}`);
            }
        }
        
        return configDir;
    }

    _getSettingsPath() {
        const configDir = this._ensureConfigDirectory();
        return GLib.build_filenamev([configDir, 'settings.json']);
    }

    _getDefaultSettings() {
        return {
            notesPath: "~/Documents/Jotite",
            headerMoods: [
                'metal', 'cobalt', 'fire', 'forest', 'lava', 'mint', 
                'amber', 'ocean', 'solar', 'cryo', 'stone', 'ice', 
                'purple', 'sunset', 'royal', 'aurora', 'sunken', 'ghost', 
                'sulfur', 'velvet', 'cicada', 'lunar', 'tonic', 'ectoplasm', 
                'polar', 'chiaroscuro', 'vanta', 'toxicvelvet', 'bruise', 
                'bismuth', 'ultralich', 'paradox', 'hazmat', 'feral'
            ],
            customMoods: {
                // Example: 'myCustomMood': ['#FF0000', '#00FF00', '#0000FF']
            }
        };
    }

    _loadSettings() {
        let text = null;
        try {
            const settingsPath = this._getSettingsPath();
            const file = Gio.File.new_for_path(settingsPath);
            
            if (!file.query_exists(null)) {
                return this._getDefaultSettings();
            }

            const [success, contents] = file.load_contents(null);
            if (!success) {
                return this._getDefaultSettings();
            }

            text = new TextDecoder().decode(contents);
            
            // Strip single-line comments (// comments)
            text = text.replace(/\/\/.*$/gm, '');
            
            // Strip multi-line comments (/* comments */)
            text = text.replace(/\/\*[\s\S]*?\*\//g, '');
            
            // Strip trailing commas before } or ]
            text = text.replace(/,(\s*[}\]])/g, '$1');
            
            const settings = JSON.parse(text);
            
            // Merge with defaults to ensure all keys exist
            const defaults = this._getDefaultSettings();
            return Object.assign({}, defaults, settings);
        } catch (e) {
            print(`Error loading settings: ${e.message}`);
            return this._getDefaultSettings();
        }
    }

    setupMonitor(callback) {
        try {
            const settingsPath = this._getSettingsPath();
            const file = Gio.File.new_for_path(settingsPath);
            
            this.monitor = file.monitor_file(Gio.FileMonitorFlags.NONE, null);
            this.monitor.connect('changed', (monitor, file, otherFile, eventType) => {
                // CHANGES_DONE_HINT = 0, DELETED = 1, CREATED = 2, ATTRIBUTE_CHANGED = 3, 
                // PRE_UNMOUNT = 4, UNMOUNTED = 5, MOVED = 6, RENAMED = 7, MOVED_IN = 8, MOVED_OUT = 9
                if (eventType === Gio.FileMonitorEvent.CHANGES_DONE_HINT || 
                    eventType === Gio.FileMonitorEvent.CREATED ||
                    eventType === Gio.FileMonitorEvent.ATTRIBUTE_CHANGED) {
                    // Add a small delay to ensure file write is complete
                    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
                        this.settings = this._loadSettings();
                        callback();
                        return false;
                    });
                }
            });
        } catch (e) {
            print(`Failed to setup settings monitor: ${e.message}`);
        }
    }

    get(key) {
        return this.settings[key];
    }
}

