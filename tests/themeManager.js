// Run from the repository root: gjs tests/themeManager.js
imports.gi.versions.Gdk = '4.0';
const { Gio, GLib } = imports.gi;
imports.searchPath.unshift(GLib.get_current_dir());
const { Constants } = imports.constants;
const { ThemeManager } = imports.theme.themeManager;
const root = GLib.dir_make_tmp('jotite-theme-test-XXXXXX');
const relativeRoot = '../'.repeat(GLib.get_home_dir().split('/').filter(Boolean).length) + root.slice(1);
Constants.THEME_PATH = [relativeRoot, 'state', 'current', 'theme', 'alacritty.toml'];
Constants.LEGACY_THEME_PATH = [relativeRoot, 'config', 'current', 'theme', 'alacritty.toml'];
const modern = GLib.build_filenamev([root, 'state', 'current', 'theme']);
const legacy = GLib.build_filenamev([root, 'config', 'current', 'theme']);
function writeTheme(dir, color) {
    GLib.mkdir_with_parents(dir, 0o700);
    GLib.file_set_contents(dir + '/alacritty.toml', `[colors.primary]\nbackground = "${color}"\n`);
}
function assertBackground(manager, expected) {
    if (manager.colors.background !== expected)
        throw new Error(`Expected ${expected}, got ${manager.colors.background}`);
}
function drainEvents() {
    const loop = new GLib.MainLoop(null, false);
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 250, () => {
        loop.quit();
        return GLib.SOURCE_REMOVE;
    });
    loop.run();
}
try {
    assertBackground(new ThemeManager(), '#0d1117');
    writeTheme(legacy, '#112233');
    assertBackground(new ThemeManager(), '#112233');
    writeTheme(modern, '#445566');
    const manager = new ThemeManager();
    assertBackground(manager, '#445566');
    manager.setupMonitor(() => {});
    for (const color of ['#778899', '#aabbcc']) {
        Gio.File.new_for_path(modern + '/alacritty.toml').delete(null);
        Gio.File.new_for_path(modern).delete(null);
        const next = GLib.path_get_dirname(modern) + '/next-theme';
        writeTheme(next, color);
        Gio.File.new_for_path(next).move(Gio.File.new_for_path(modern), Gio.FileCopyFlags.NONE, null, null);
        drainEvents();
        assertBackground(manager, color);
    }
    manager.monitor.cancel();
    manager.currentMonitor.cancel();
    if (manager.gtkMonitor) manager.gtkMonitor.cancel();
    print('PASS: missing theme, legacy fallback, new-path precedence, repeated directory replacement');
} finally {
    GLib.spawn_sync(null, ['rm', '-rf', '--', root], null, GLib.SpawnFlags.SEARCH_PATH, null);
}
