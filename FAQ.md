## Keyboard Shortcuts

- **Ctrl+S** or **Ctrl+Enter**: Save note
- **Ctrl+Shift+S**: Save As
- **Ctrl+N**: New note
- **Ctrl+O**: Open note
- **Ctrl+Plus**: Zoom in
- **Ctrl+Minus**: Zoom out
- **Ctrl+0**: Reset zoom
- **Ctrl+X**: Cut line (when no selection)
- **Ctrl+Up/Down**: Move line up/down
- **Tab**: Indent bullet point / Increase header level
- **Shift+Tab**: Outdent bullet point / Decrease header level

### Settings

Click the ⚙ (settings) button in the bottom-right corner to open `settings.json`. Changes are applied immediately when you save the file!

#### Customizing Header Colors

The `headerMoods` array determines which color gradient is used for each heading level:
- `#` uses the first mood in the array
- `##` uses the second mood
- `###` uses the third mood, and so on...

**To change header colors**: Reorder the mood names in the `headerMoods` array. For example, to make `#` headers use fire colors, move `"fire"` to the first position.

##### Adding Custom Moods

You can create your own color gradients in the `customMoods` section:

```json
"customMoods": {
  "solidRed": ["#FF0000"],
  "redBlue": ["#FF0000", "#0000FF"],
  "rainbow": ["#FF0000", "#FFFF00", "#00FF00", "#0000FF", "#FF00FF"]
}
```

Then add the mood name (e.g., `"rainbow"`) to the `headerMoods` array to use it. Custom moods can have any number of colors (1 or more). The gradient will smoothly loop through all colors.

###### Available Moods

metal, cobalt, fire, forest, lava, mint, amber, ocean, solar, cryo, stone, ice, purple, sunset, royal, aurora, sunken, ghost, sulfur, velvet, cicada, lunar, tonic, ectoplasm, polar, chiaroscuro, vanta, toxicvelvet, bruise, bismuth, ultralich, paradox, hazmat, feral


######## Markdown Syntax

- **Headers**: # H1, ## H2, ### H3, etc.
  - Use **Tab** to increase header level (add a #)
  - Use **Shift+Tab** to decrease header level (remove a #)
- **Bold**: **text** or __text__
- **Italic**: *text* or _text_
- **Code**: `code`
- **Code block**: ```code```
- **Strikethrough**: ~~text~~
- **Underline**: ++text++
- **Links**: [text](url)
- **Bullets**: - item or * item
  - Use **Tab** to indent bullets
  - Use **Shift+Tab** to outdent bullets
- **Todos**: [ ] unchecked or [X] checked

###### Where are my notes saved?

Notes are saved in: ~/Documents/Jotite/

#### How do I customize the theme?

Jotite follows the Alacritty theme at: ~/.config/omarchy/current/theme/alacritty.toml

The theme colors are automatically applied to the editor background, text, and UI elements.