const { Gio, GLib, Adw, GObject } = imports.gi;
const { Constants } = imports.constants;

// Import will be added after window.js is created
// const JotWindow = imports.ui.window.JotWindow;

// ============================================================================
// Application
// ============================================================================

var JotApplication = GObject.registerClass(
class JotApplication extends Adw.Application {
    _init() {
        super._init({
            application_id: Constants.APP_ID,
            flags: Gio.ApplicationFlags.HANDLES_OPEN | Gio.ApplicationFlags.NON_UNIQUE,
        });
        this._fileToOpen = null;
        
        // Ensure font is installed
        this._ensureFontInstalled();
        
        // Set up quit handler to check for unsaved changes
        this._setupQuitHandler();
    }
    
    _setupQuitHandler() {
        // Create a quit action that checks for unsaved changes first
        const quitAction = new Gio.SimpleAction({ name: 'quit' });
        quitAction.connect('activate', () => {
            this._handleQuit();
        });
        this.add_action(quitAction);
        
        // Set Ctrl+Q as the keyboard accelerator for quit
        this.set_accels_for_action('app.quit', ['<Control>q']);
    }
    
    _handleQuit() {
        // Get all application windows
        const windows = this.get_windows();
        
        // Check if any window has unsaved changes
        const windowWithUnsavedChanges = windows.find(window => 
            window._hasUnsavedChanges && window._hasUnsavedChanges === true
        );
        
        if (windowWithUnsavedChanges) {
            // Show dialog on the window with unsaved changes
            windowWithUnsavedChanges._showUnsavedChangesDialog(() => {
                // User chose to discard - quit the app
                this.quit();
            }, () => {
                // User chose to save
                windowWithUnsavedChanges._saveNote();
                // Quit after save completes
                this.quit();
            });
        } else {
            // No unsaved changes, quit directly
            this.quit();
        }
    }
    
    _ensureFontInstalled() {
        try {
            // Check if font is already installed by checking fontconfig
            const checkCmd = ['fc-list', ':', 'family', 'file'];
            const [, checkOutput] = GLib.spawn_command_line_sync(checkCmd.join(' '));
            const fontList = new TextDecoder().decode(checkOutput);
            
            if (fontList.toLowerCase().includes('pxlxxl')) {
                return;
            }
            
            // Try multiple methods to find the script directory
            let scriptPath = null;
            
            // Method 1: Try using imports.system.programInvocationName (the actual script path)
            if (imports.system.programInvocationName) {
                const invocationPath = imports.system.programInvocationName;
                if (invocationPath.startsWith('./') || invocationPath.startsWith('/')) {
                    scriptPath = GLib.path_get_dirname(GLib.canonicalize_filename(invocationPath, GLib.get_current_dir()));
                }
            }
            
            // Method 2: Try programPath
            if (!scriptPath) {
                scriptPath = GLib.path_get_dirname(imports.system.programPath);
            }
            
            // Method 3: Check current directory
            if (!scriptPath || scriptPath === '/usr/bin') {
                scriptPath = GLib.get_current_dir();
            }
            
            const fontSourcePath = GLib.build_filenamev([scriptPath, 'pxlxxl.ttf']);
            
            // Check if font file exists in script directory
            const fontFile = Gio.File.new_for_path(fontSourcePath);
            if (!fontFile.query_exists(null)) {
                print(`Warning: Font file not found at ${fontSourcePath}`);
                print('Please ensure pxlxxl.ttf is in the same directory as jotite.js');
                return;
            }
            
            // Install to user fonts directory
            const fontDir = GLib.build_filenamev([GLib.get_home_dir(), '.local', 'share', 'fonts', 'jotite']);
            const fontDirFile = Gio.File.new_for_path(fontDir);
            
            // Create directory if it doesn't exist
            if (!fontDirFile.query_exists(null)) {
                fontDirFile.make_directory_with_parents(null);
            }
            
            // Copy font file
            const fontDestPath = GLib.build_filenamev([fontDir, 'pxlxxl.ttf']);
            const fontDestFile = Gio.File.new_for_path(fontDestPath);
            fontFile.copy(fontDestFile, Gio.FileCopyFlags.OVERWRITE, null, null);
            
            // Update font cache
            const updateCmd = ['fc-cache', '-f', fontDir];
            const [cacheSuccess, cacheOutput, cacheError] = GLib.spawn_command_line_sync(updateCmd.join(' '));
            
            if (!cacheSuccess) {
                print(`Warning: fc-cache failed: ${new TextDecoder().decode(cacheError)}`);
            }
        } catch (e) {
            print(`ERROR: Could not auto-install font: ${e.message}`);
            print(`Stack trace: ${e.stack || 'N/A'}`);
        }
    }

    vfunc_activate() {
        // Import dynamically to avoid circular dependency
        const JotWindow = imports.ui.window.JotWindow;
        
        // Always create a new window to allow multiple instances
        const window = new JotWindow(this);

        if (this._fileToOpen) {
            window.loadFile(this._fileToOpen);
            this._fileToOpen = null;
        }

        window.present();
    }

    vfunc_open(files, hint) {
        if (files.length > 0) {
            this._fileToOpen = files[0];
        }
        this.activate();
    }
});

