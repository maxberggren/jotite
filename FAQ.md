## Keyboard Shortcuts

- **Ctrl+S** or **Ctrl+Enter**: Save note
- **Ctrl+Shift+S**: Save As
- **Ctrl+N**: New note
- **Ctrl+O**: Open note
- **Ctrl+F**: Find (**F3** / **Ctrl+G** next, **Shift+F3** / **Ctrl+Shift+G** previous)
- **Ctrl+Z** / **Ctrl+Shift+Z** / **Ctrl+Y**: Undo / redo
- **Ctrl+T**: Toggle the task checkbox on the current line
- **Ctrl+Plus** / **Ctrl+Minus** / **Ctrl+0**: Zoom in / out / reset (per window)
- **Ctrl+X**: Cut line (when nothing is selected)
- **Ctrl+Up/Down**: Move line (or selected lines) up/down
- **Tab** / **Shift+Tab**: Nest / un-nest a list item, or add / remove a `#` on a heading
- **Enter**: Continue the list (Enter on an empty item ends it); **Shift+Enter**: plain newline
- **Ctrl+Click**: Open a link
- **Escape**: Close search, or close the window
- **Ctrl+Q**: Quit

### Settings

Click the ⚙ (settings) button in the bottom-right corner to open `settings.json` (`~/.config/jotite/settings.json`). Changes are applied as soon as you save the file. If the file contains a JSON error, Jotite keeps using the last valid settings and shows the error in the status bar (click it to open the file). `//` and `/* */` comments are allowed.

| Key | Default | Meaning |
|---|---|---|
| `notesPath` | `~/Documents/Jotite` | Where new notes are saved and today's note is looked up |
| `autosave` | `true` | Save notes that already have a file 1.5 s after you stop typing, on focus loss and on close |
| `headerMoods` | all built-in moods | Mood used for each heading level |
| `customMoods` | `{}` | Your own color gradients |

#### Customizing Header Colors

The `headerMoods` array determines which color gradient is used for each heading level:
- `#` uses the first mood in the array
- `##` uses the second mood
- `###` uses the third mood, and so on...

**To change header colors**: Reorder the mood names in the `headerMoods` array. For example, to make `#` headers use fire colors, move `"fire"` to the first position. Unknown names are ignored; if none are valid, the built-in moods are used.

#### Adding Custom Moods

You can create your own color gradients in the `customMoods` section:

```json
"customMoods": {
  "solidRed": ["#FF0000"],
  "redBlue": ["#FF0000", "#0000FF"],
  "rainbow": ["#FF0000", "#FFFF00", "#00FF00", "#0000FF", "#FF00FF"]
}
```

Then add the mood name (e.g., `"rainbow"`) to the `headerMoods` array to use it. Custom moods can have any number of colors (1 or more). The gradient smoothly loops through all colors.

#### Available Moods

metal, cobalt, fire, forest, lava, mint, amber, ocean, solar, cryo, stone, ice, purple, sunset, royal, aurora, sunken, ghost, sulfur, velvet, cicada, lunar, tonic, ectoplasm, polar, chiaroscuro, vanta, toxicvelvet, bruise, bismuth, ultralich, paradox, hazmat, feral

### Markdown Syntax

Jotite follows CommonMark/GitHub rules for everything it renders:

- **Headings**: `# H1` … `###### H6`
- **Bold**: `**text**` or `__text__`; **Italic**: `*text*` or `_text_`; **Bold italic**: `***text***`
- **Strikethrough**: `~~text~~`
- **Inline code**: `` `code` `` (nothing inside code is formatted)
- **Code blocks**: fenced with ```` ``` ```` or `~~~` on their own lines
- **Links**: `[text](url)`, `<https://…>`, and bare `https://…` URLs; **Images**: `![alt](src)` (shown as the alt text)
- **Lists**: `-`, `*` or `+` bullets, `1.` or `1)` numbers; **Tab** nests, **Shift+Tab** un-nests
- **Tasks**: `- [ ] todo` / `- [X] done` (or `[ ]` at the start of a line)
  - **Double-click** the `[ ]` to toggle it, or press **Ctrl+T** on the line
- **Blockquotes**: `> quote` (nest with `> >`)
- **Horizontal rule**: `---`, `***`, `___` or `* * *`
- **Escapes**: `\*not italic\*`
- **Arrows**: `->`, `<-` and `<->` are displayed as →, ← and ↔ (the file keeps the original characters)

Not supported: setext headings (a `---` line is always a rule), indented code blocks, reference-style links, and tables (shown as plain text).

### Where are my notes saved?

In `notesPath` (default `~/Documents/Jotite/`). Notes that already have a file are autosaved. Untitled notes are kept as recovery drafts in `~/.local/state/jotite/drafts/` until you save or discard them, and are restored the next time you start Jotite.

### What if a file changes on disk while it's open?

If you have no unsaved edits, Jotite reloads it. If you do, Jotite shows a banner and pauses autosave, and saving asks whether to reload, overwrite or cancel.

### How do I customize the theme?

Jotite follows your Omarchy theme (`~/.local/state/omarchy/current/theme/alacritty.toml`, falling back to `~/.config/omarchy/current/theme/alacritty.toml`) and updates live when you switch themes.
