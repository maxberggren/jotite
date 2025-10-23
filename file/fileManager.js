const { GLib, Gio } = imports.gi;
const { Constants } = imports.constants;

// ============================================================================
// File Manager
// ============================================================================

var FileManager = class FileManager {
    static getJotDirectory(settingsManager = null) {
        const homeDir = GLib.get_home_dir();
        
        // Try to get path from settings
        if (settingsManager) {
            const notesPath = settingsManager.get('notesPath');
            if (notesPath) {
                // Handle ~ expansion
                let expandedPath = notesPath;
                if (expandedPath.startsWith('~/')) {
                    expandedPath = GLib.build_filenamev([homeDir, expandedPath.substring(2)]);
                } else if (expandedPath === '~') {
                    expandedPath = homeDir;
                } else if (!expandedPath.startsWith('/')) {
                    // Relative path - make it relative to home
                    expandedPath = GLib.build_filenamev([homeDir, expandedPath]);
                }
                return expandedPath;
            }
        }
        
        // Fall back to default
        return GLib.build_filenamev([homeDir, ...Constants.JOT_DIR]);
    }

    static ensureJotDirectoryExists(settingsManager = null) {
        const jotDir = this.getJotDirectory(settingsManager);
        const jotDirFile = Gio.File.new_for_path(jotDir);

        try {
            jotDirFile.make_directory_with_parents(null);
        } catch (e) {
            if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.EXISTS)) {
                print(`Error creating directory: ${e.message}`);
                throw e;
            }
        }
    }

    static normalizeFilename(title) {
        let normalized = title.trim()
            .replace(/\s+/g, '-')
            .replace(/[^a-zA-Z0-9-_]/g, '')
            .toLowerCase();

        if (normalized.length > 50) {
            normalized = normalized.substring(0, 50);
        }

        return normalized;
    }

    static generateFilename(title) {
        if (title) {
            const normalized = this.normalizeFilename(title);
            if (normalized) {
                return `${normalized}.md`;
            }
        }

        const now = GLib.DateTime.new_now_local();
        return `${now.format('%Y-%m-%d')}.md`;
    }

}

