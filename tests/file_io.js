// Run from the repository root: gjs tests/file_io.js
// Byte-preserving load/save, encoding refusal, missing files, atomic writes,
// external-change (etag) detection, filename slugs and drafts.
const { Gio, GLib } = imports.gi;
imports.searchPath.unshift(GLib.get_current_dir());
const { FileIO } = imports.file.fileIO;
const { FileManager } = imports.file.fileManager;
const { Drafts } = imports.file.drafts;

let failures = 0, passes = 0;
function check(name, cond, detail = '') {
    if (cond) {
        passes++;
    } else {
        failures++;
        printerr(`FAIL: ${name} ${detail}`);
    }
}
function bytesEqual(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
}
const enc = s => new TextEncoder().encode(s);
const root = GLib.dir_make_tmp('jotite-fileio-XXXXXX');
const pathOf = name => GLib.build_filenamev([root, name]);
function writeRaw(name, bytes) {
    GLib.file_set_contents(pathOf(name), bytes);
    return Gio.File.new_for_path(pathOf(name));
}
function readRaw(name) {
    return GLib.file_get_contents(pathOf(name))[1];
}

try {
    // --- Round trips: open + save without edits is byte-identical ---------
    const cases = {
        'lf.md': enc('# Title\n\n- item\n- item 2\n'),
        'crlf.md': enc('# Title\r\n\r\n- item\r\n- item 2\r\n'),
        'bom.md': new Uint8Array([0xEF, 0xBB, 0xBF, ...enc('# BOM file\nline\n')]),
        'bom-crlf.md': new Uint8Array([0xEF, 0xBB, 0xBF, ...enc('a\r\nb\r\n')]),
        'no-trailing-newline.md': enc('# Title\nlast line without newline'),
        'crlf-no-trailing.md': enc('a\r\nb'),
        'arrows.md': enc('a -> b <- c\n`x -> y`\n'),
        'unicode.md': enc('# Måndag möte\nÅäö 日本語 😀😀 ✓\n'),
        'empty.md': new Uint8Array(0),
        'only-newlines.md': enc('\n\n\n'),
        'trailing-spaces.md': enc('line   \n\t\ttabs\n  \n'),
    };
    for (const [name, bytes] of Object.entries(cases)) {
        const file = writeRaw(name, bytes);
        const r = FileIO.readFile(file);
        check(`${name}: exists`, r.exists);
        check(`${name}: buffer text has no \\r`, !r.text.includes('\r'));
        check(`${name}: buffer text has no BOM`, r.text.charCodeAt(0) !== 0xFEFF);
        FileIO.writeFile(file, r.text, r.format, r.etag);
        check(`${name}: byte-identical after open+save`, bytesEqual(readRaw(name), bytes));
    }

    // CRLF detection and BOM flag
    const crlf = FileIO.decode(cases['crlf.md']);
    check('crlf detected', crlf.format.eol === '\r\n');
    check('crlf text normalized', crlf.text === '# Title\n\n- item\n- item 2\n');
    check('bom detected', FileIO.decode(cases['bom.md']).format.bom === true);
    check('lf default', FileIO.decode(cases['lf.md']).format.eol === '\n');
    // Edits in a CRLF file are written with CRLF
    check('crlf re-emitted', new TextDecoder().decode(FileIO.encode('x\ny\n', crlf.format)) === 'x\r\ny\r\n');
    // Mixed endings (or lone CR) are kept verbatim: no conversion either way
    for (const mixed of ['a\r\nb\nc\n', 'a\r\nb\r\nc\nd\r\n', 'a\rb\rc', 'a\r\nb\rc\r\n']) {
        const d = FileIO.decode(enc(mixed));
        check(`mixed ${JSON.stringify(mixed)}: kept verbatim`, d.format.eol === '\n' && d.text === mixed);
        check(`mixed ${JSON.stringify(mixed)}: round trip`,
            new TextDecoder().decode(FileIO.encode(d.text, d.format)) === mixed);
        const file = writeRaw('mixed.md', enc(mixed));
        const r = FileIO.readFile(file);
        FileIO.writeFile(file, r.text, r.format, r.etag);
        check(`mixed ${JSON.stringify(mixed)}: byte-identical after open+save`, bytesEqual(readRaw('mixed.md'), enc(mixed)));
    }
    // An edit in a mixed file only changes the edited line
    const mixedDoc = FileIO.decode(enc('a\r\nb\r\nc\nd\r\n'));
    check('mixed: edit keeps other endings', new TextDecoder().decode(
        FileIO.encode(mixedDoc.text.replace('c\n', 'cX\n'), mixedDoc.format)) === 'a\r\nb\r\ncX\nd\r\n');

    // --- Invalid UTF-8 / binary is refused, never replaced -----------------
    for (const [name, bytes] of [
        ['latin1.md', new Uint8Array([0x48, 0xE9, 0x6C, 0x6C, 0x6F, 0x0A])],
        ['truncated.md', new Uint8Array([0x61, 0xE2, 0x82])],
        ['nul.md', new Uint8Array([0x61, 0x00, 0x62])],
    ]) {
        const file = writeRaw(name, bytes);
        let threw = null;
        try {
            FileIO.readFile(file);
        } catch (e) {
            threw = e;
        }
        check(`${name}: refused`, threw instanceof FileIO.EncodingError, String(threw));
        check(`${name}: untouched`, bytesEqual(readRaw(name), bytes));
    }

    // --- Missing file: empty document bound to the path --------------------
    const missing = Gio.File.new_for_path(pathOf('sub/dir/new-note.md'));
    const m = FileIO.readFile(missing);
    check('missing: exists=false', m.exists === false);
    check('missing: empty text', m.text === '');
    check('missing: not created by reading', !missing.query_exists(null));
    FileIO.writeFile(missing, 'hello\n', m.format, m.etag);
    check('missing: created on save with parent dirs', missing.query_exists(null) &&
        new TextDecoder().decode(missing.load_contents(null)[1]) === 'hello\n');

    // Directory is an error, not an empty buffer
    let dirErr = null;
    try {
        FileIO.readFile(Gio.File.new_for_path(root));
    } catch (e) {
        dirErr = e;
    }
    check('directory refused', dirErr !== null);

    // --- Atomic save: new inode via temp+rename, no temp files left ---------
    const atomic = writeRaw('atomic.md', enc('one\n'));
    const inodeBefore = atomic.query_info('unix::inode', 0, null).get_attribute_uint64('unix::inode');
    const r1 = FileIO.readFile(atomic);
    FileIO.writeFile(atomic, 'two\n', r1.format, r1.etag);
    const inodeAfter = atomic.query_info('unix::inode', 0, null).get_attribute_uint64('unix::inode');
    check('atomic: replaced via rename (new inode)', inodeBefore !== inodeAfter);
    check('atomic: content', new TextDecoder().decode(readRaw('atomic.md')) === 'two\n');
    const leftovers = [];
    const en = Gio.File.new_for_path(root).enumerate_children('standard::name', 0, null);
    let info;
    while ((info = en.next_file(null)))
        if (info.get_name().startsWith('.goutputstream') || info.get_name().startsWith('.atomic')) leftovers.push(info.get_name());
    check('atomic: no temp files left', leftovers.length === 0, leftovers.join(','));

    // Permissions are preserved across the atomic replace
    GLib.chmod(pathOf('atomic.md'), 0o640);
    const r2 = FileIO.readFile(atomic);
    FileIO.writeFile(atomic, 'three\n', r2.format, r2.etag);
    const mode = atomic.query_info('unix::mode', 0, null).get_attribute_uint32('unix::mode') & 0o777;
    check('atomic: mode preserved', mode === 0o640, mode.toString(8));

    // --- External change detection via etag -------------------------------
    const ext = writeRaw('external.md', enc('original\n'));
    const loaded = FileIO.readFile(ext);
    GLib.usleep(20000);
    GLib.file_set_contents(pathOf('external.md'), 'changed by another program\n');
    let conflict = null;
    try {
        FileIO.writeFile(ext, 'my edit\n', loaded.format, loaded.etag);
    } catch (e) {
        conflict = e;
    }
    check('external change: WRONG_ETAG', FileIO.isWrongEtag(conflict), String(conflict));
    check('external change: not clobbered',
        new TextDecoder().decode(readRaw('external.md')) === 'changed by another program\n');
    // Explicit overwrite (no etag) succeeds
    FileIO.writeFile(ext, 'my edit\n', loaded.format, null);
    check('overwrite after conflict', new TextDecoder().decode(readRaw('external.md')) === 'my edit\n');
    // Etag returned by a save matches what a later query sees (so our own
    // writes are not mistaken for external changes)
    const e1 = FileIO.writeFile(ext, 'again\n', loaded.format, null);
    check('own-write etag matches query', e1 === FileIO.queryEtag(ext));

    // --- Filename slugs ----------------------------------------------------
    const slug = t => FileManager.normalizeFilename(t);
    check('slug keeps unicode', slug('Måndag möte') === 'måndag-möte', slug('Måndag möte'));
    check('slug strips unsafe', slug('a/b\\c:d*e?f"g<h>i|j') === 'abcdefghij', slug('a/b\\c:d*e?f"g<h>i|j'));
    check('slug collapses whitespace', slug('  hello   big   world ') === 'hello-big-world');
    check('slug CJK', slug('日本語 ノート') === '日本語-ノート');
    check('slug strips emoji', slug('😀 Party!') === 'party', slug('😀 Party!'));
    check('slug caps length', Array.from(slug('å'.repeat(200))).length === 64);
    check('slug no leading dot', !slug('...hidden').startsWith('.'));
    check('generateFilename empty -> date', /^\d{4}-\d{2}-\d{2}\.md$/.test(FileManager.generateFilename('!!!')));
    GLib.file_set_contents(pathOf('taken.md'), 'x');
    GLib.file_set_contents(pathOf('taken-2.md'), 'x');
    check('uniqueFilename avoids collisions', FileManager.uniqueFilename(root, 'taken.md') === 'taken-3.md');
    check('uniqueFilename free name unchanged', FileManager.uniqueFilename(root, 'free.md') === 'free.md');

    // --- Drafts ------------------------------------------------------------
    const drafts = new Drafts(pathOf('drafts'));
    const id = drafts.newId();
    drafts.write(id, 'draft text');
    check('own drafts are not orphans', drafts.listOrphans().length === 0);
    // A draft from a dead process is an orphan
    const deadId = '20200101T000000-999999999-1';
    drafts.write(deadId, 'crashed text');
    const orphans = drafts.listOrphans();
    check('orphan draft listed', orphans.length === 1 && orphans[0].text === 'crashed text');
    drafts.remove(deadId);
    drafts.remove(id);
    check('drafts removed', drafts.listOrphans().length === 0 &&
        !GLib.file_test(drafts.pathFor(id), GLib.FileTest.EXISTS));
} finally {
    GLib.spawn_sync(null, ['rm', '-rf', '--', root], null, GLib.SpawnFlags.SEARCH_PATH, null);
}

if (failures) {
    printerr(`${failures} failed, ${passes} passed`);
    imports.system.exit(1);
}
print(`PASS: file_io (${passes} checks)`);
