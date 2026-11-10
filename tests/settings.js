// Run from the repository root: gjs tests/settings.js
// Settings parsing (comments, "//" inside strings), last-good fallback on
// invalid JSON, notesPath handling and mood config building.
const { Gio, GLib } = imports.gi;
imports.searchPath.unshift(GLib.get_current_dir());
const { SettingsManager } = imports.settings.settingsManager;
const { buildMoodConfig } = imports.settings.moods;
const { FileManager } = imports.file.fileManager;

let failures = 0, passes = 0;
function check(name, cond, detail = '') {
    if (cond) {
        passes++;
    } else {
        failures++;
        printerr(`FAIL: ${name} ${detail}`);
    }
}
const root = GLib.dir_make_tmp('jotite-settings-XXXXXX');
const configDir = GLib.build_filenamev([root, 'config']);
const stateDir = GLib.build_filenamev([root, 'state']);
GLib.mkdir_with_parents(configDir, 0o700);
const settingsPath = GLib.build_filenamev([configDir, 'settings.json']);
const writeSettings = text => GLib.file_set_contents(settingsPath, text);
const make = () => new SettingsManager({ configDir, stateDir });

try {
    // --- Comment stripping is string aware ---------------------------------
    const strip = SettingsManager.stripJsonComments;
    check('// in string kept', JSON.parse(strip('{"u": "https://example.com//x"} // c')).u === 'https://example.com//x');
    check('/* */ in string kept', JSON.parse(strip('{"u": "a /* b */ c"}')).u === 'a /* b */ c');
    check('escaped quote in string', JSON.parse(strip('{"u": "say \\"//hi\\""}')).u === 'say "//hi"');
    check('block comment removed', JSON.parse(strip('{ /* x */ "a": 1 }')).a === 1);
    check('trailing comma removed', JSON.parse(strip('{"a": [1, 2,], }')).a.length === 2);
    check('comma in string kept', JSON.parse(strip('{"a": "x,]"}')).a === 'x,]');

    // --- Missing file -> defaults ------------------------------------------
    let sm = make();
    check('defaults when missing', sm.get('notesPath') === '~/Documents/Jotite' && sm.get('autosave') === true && sm.error === null);

    // --- Valid file with comments and URLs ---------------------------------
    writeSettings(`{
        // my notes
        "notesPath": "~/Notes//daily", // trailing comment
        "autosave": false,
        "link": "https://example.com/a//b",
        /* moods */
        "headerMoods": ["fire", "ocean",],
    }`);
    sm = make();
    check('valid: no error', sm.error === null, sm.error);
    check('valid: notesPath', sm.get('notesPath') === '~/Notes//daily');
    check('valid: autosave false', sm.get('autosave') === false);
    check('valid: url with // intact', sm.get('link') === 'https://example.com/a//b');
    check('valid: customMoods default merged', typeof sm.get('customMoods') === 'object');

    // --- Invalid JSON keeps last-good settings (same session) --------------
    writeSettings('{ "notesPath": "~/Broken", oops }');
    const ok = sm.reload();
    check('invalid: reload returns false', ok === false);
    check('invalid: error reported', typeof sm.error === 'string' && sm.error.includes('not valid JSON'), sm.error);
    check('invalid: previous notesPath kept', sm.get('notesPath') === '~/Notes//daily', sm.get('notesPath'));
    check('invalid: previous autosave kept', sm.get('autosave') === false);

    // --- Invalid JSON at startup uses the cached last-good copy ------------
    const fresh = make();
    check('startup invalid: error reported', !!fresh.error);
    check('startup invalid: last-good notesPath', fresh.get('notesPath') === '~/Notes//daily', fresh.get('notesPath'));

    // --- Fixing the file clears the error ----------------------------------
    writeSettings('{ "notesPath": "/tmp/jot-notes" }');
    check('fixed: reload ok', sm.reload() === true && sm.error === null);
    check('fixed: new notesPath', sm.get('notesPath') === '/tmp/jot-notes');
    check('fixed: autosave back to default', sm.get('autosave') === true);

    // Non-object JSON is an error too
    writeSettings('[1, 2]');
    check('array rejected', sm.reload() === false && sm.get('notesPath') === '/tmp/jot-notes');

    // --- notesPath is honored ----------------------------------------------
    const fakeSm = notesPath => ({ get: k => (k === 'notesPath' ? notesPath : undefined) });
    const home = GLib.get_home_dir();
    check('notesPath absolute', FileManager.getJotDirectory(fakeSm('/srv/notes')) === '/srv/notes');
    check('notesPath ~', FileManager.getJotDirectory(fakeSm('~/My Notes')) === `${home}/My Notes`);
    check('notesPath relative to home', FileManager.getJotDirectory(fakeSm('notes')) === `${home}/notes`);
    check('notesPath empty -> default', FileManager.getJotDirectory(fakeSm('')) === `${home}/Documents/Jotite`);
    check('today note uses notesPath', FileManager.todayNotePath(fakeSm('/srv/notes')).startsWith('/srv/notes/'));
    check('getJotDirectory does not create', !GLib.file_test('/srv/notes', GLib.FileTest.EXISTS));

    // --- Filename slug: Unicode ---------------------------------------------
    check('slug Måndag möte', FileManager.generateFilename('Måndag möte') === 'måndag-möte.md',
        FileManager.generateFilename('Måndag möte'));
    check('slug NFD input normalized', FileManager.normalizeFilename('Ma\u030Andag') === 'måndag');

    // --- Mood config ---------------------------------------------------------
    const moods = buildMoodConfig({
        get: k => ({
            headerMoods: ['mine', 'fire', 'nope'],
            customMoods: { mine: ['#111111', '#222222'], _comment: 'x', bad: 'notarray' },
        })[k],
    });
    check('moods: order and filtering', JSON.stringify(Object.keys(moods)) === '["mine","fire"]');
    check('moods: custom colors', moods.mine.colors[1] === '#222222');

    // --- Repo settings.json is valid and has the real schema -----------------
    const [, repoBytes] = GLib.file_get_contents('settings.json');
    const repo = SettingsManager.parseSettings(new TextDecoder().decode(repoBytes));
    check('repo settings: schema', ['notesPath', 'autosave', 'headerMoods', 'customMoods'].every(k => k in repo));
    const extra = Object.keys(JSON.parse(new TextDecoder().decode(repoBytes)))
        .filter(k => !['notesPath', 'autosave', 'headerMoods', 'customMoods'].includes(k));
    check('repo settings: no unknown keys', extra.length === 0, extra.join(','));

    // --- Monitor reloads after an edit ------------------------------------
    writeSettings('{ "notesPath": "/a" }');
    sm.reload();
    let calls = 0;
    sm.setupMonitor(() => calls++);
    writeSettings('{ "notesPath": "/b" }');
    const loop = new GLib.MainLoop(null, false);
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 600, () => {
        loop.quit();
        return GLib.SOURCE_REMOVE;
    });
    loop.run();
    check('monitor: reloaded', sm.get('notesPath') === '/b' && calls >= 1, `calls=${calls} notesPath=${sm.get('notesPath')}`);
    sm.destroy();
    check('monitor: destroyed', sm.monitor === null);
} finally {
    GLib.spawn_sync(null, ['rm', '-rf', '--', root], null, GLib.SpawnFlags.SEARCH_PATH, null);
}

if (failures) {
    printerr(`${failures} failed, ${passes} passed`);
    imports.system.exit(1);
}
print(`PASS: settings (${passes} checks)`);
