// Run from the repository root: gjs tests/markdown_perf.js
// Pathological single lines (~100 KB) must parse in near-linear time.
// Each case is timed as the best of a few runs (the machine may be busy);
// the limit is 50 ms per 100 KB line.
const { GLib } = imports.gi;
imports.searchPath.unshift(GLib.get_current_dir());
const Parser = imports.markdown.parser;

const LIMIT_MS = 50;
const SIZE = 100000;
const fill = (unit) => unit.repeat(Math.ceil(SIZE / unit.length)).slice(0, SIZE);
const ticks = (n) => '`'.repeat(n);

const cases = [
    ['plain text', fill('lorem ipsum ')],
    ['many <', fill('<')],
    ['many <a', fill('<a ')],
    ['autolink-ish <a:b', fill('<a:bc ')],
    ['many [', fill('[')],
    ['many ]', fill(']')],
    ['many [x', fill('[x')],
    ['many [a](', fill('[a](')],
    ['many [a]( then )', fill('[a](') + ')'],
    ['nested parens', '[a](' + '('.repeat(SIZE / 2) + ')'.repeat(SIZE / 2 - 10)],
    ['unclosed titles', fill('[a](b ("x ')],
    ['unclosed quote titles', fill('[a](b "x ')],
    ['angle destinations', fill('[a](<')],
    ['links', fill('[a](b) ')],
    ['bare urls', fill('http://a.b/c ')],
    ['links + urls', fill('[a](b) http://x.y/z ')],
    ['urls with parens', fill('http://a.b/(c) ')],
    ['backticks', fill('` ')],
    ['backtick runs', fill('``` x ')],
    ['unclosed backticks', '``' + fill('a ')],
    ['distinct backtick lengths', Array.from({ length: 440 }, (_, k) => ticks(k + 1)).join(' ')],
    ['stars', fill('*a ')],
    ['underscores', fill('_a_ ')],
    ['mixed delimiters', fill('*_~')],
    ['strikethrough', fill('~~a ')],
    ['emphasis in links', fill('*[a](b)_ ')],
    ['escapes', fill('\\*')],
    ['escaped brackets', fill('\\[a](')],
    ['unclosed comments', fill('a <!-- ')],
    ['comments', 'x ' + fill('<!-- a --> ')],
    ['arrows', fill('-> <- ')],
    ['emoji', fill('😀 *a* ')],
];

let failures = 0;
for (const [name, line] of cases) {
    let best = Infinity;
    for (let k = 0; k < 3; k++) {
        const t = GLib.get_monotonic_time();
        Parser.parseLine(line, '');
        best = Math.min(best, GLib.get_monotonic_time() - t);
    }
    const ms = best / 1000;
    const ok = ms < LIMIT_MS;
    if (!ok) failures++;
    print(`${ok ? 'ok  ' : 'FAIL'} ${name.padEnd(28)} ${String(line.length).padStart(7)} chars ${ms.toFixed(1).padStart(7)} ms`);
}
print(`markdown_perf: ${cases.length - failures} passed, ${failures} failed (limit ${LIMIT_MS} ms per line)`);
if (failures) imports.system.exit(1);
