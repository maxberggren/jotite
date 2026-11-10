# Markdown Corner Cases Test File

## Headings Edge Cases

# Heading 1 with **bold** and *italic*
## Heading 2 with `code` and ~~strikethrough~~
### Heading 3 with [link](https://example.com)
#### Heading 4 with ++underline++
##### Heading 5 with emoji 🎉
###### Heading 6 with multiple emojis 🚀🔥💯

####### Heading 7 (should cap at 6)
######## Heading 8 (should cap at 6)
######### Heading 9 (should cap at 6)

#No space heading (should not match)
#  Multiple spaces heading
#	Tab character heading
#Heading with only hash

## Bold and Italic Edge Cases

**bold text**
__bold text__
*bold text* (should be italic, not bold)
_bold text_ (should be italic, not bold)

**bold**text**bold** (nested bold)
***bold and italic***
___bold and italic___
**_bold and italic_**
*__bold and italic__*

**bold with *italic* inside**
*italic with **bold** inside*

**unclosed bold
**unclosed bold with text
unclosed bold**

*bold** (mismatched)
**bold* (mismatched)
*bold*text**bold** (overlapping)

**empty bold**
*empty italic*
__empty bold__
_empty italic_

**bold**text**bold**text**bold** (multiple adjacent)
*italic*text*italic*text*italic* (multiple adjacent)

## Code Edge Cases

`inline code`
``double backticks``
```triple backticks```
`code with **bold** inside` (should not render bold)
`code with *italic* inside` (should not render italic)
`code with [link](url) inside` (should not render link)

`unclosed code
`code`text`code` (adjacent code blocks)

```
code block
```

```
code block with **bold** (should not render)
code block with *italic* (should not render)
code block with `inline code` (should not render)
```

```
unclosed code block
more text here

```
closed code block
```

````
four backticks code block
````

## Links Edge Cases

[simple link](https://example.com)
[link with **bold**](https://example.com)
[link with *italic*](https://example.com)
[link with `code`](https://example.com)
[link with [nested]](https://example.com)
[link with (nested)](https://example.com)

[unclosed link](https://example.com
[unclosed link text](https://example.com)
[link](unclosed url

[empty link text]()
[empty link url]()

[link](https://example.com/path?query=value&other=test)
[link](https://example.com#anchor)
[link](relative/path/to/file.md)

## Strikethrough and Underline

~~strikethrough text~~
++underline text++
~~strikethrough with **bold**~~
++underline with *italic*++
~~strikethrough with `code`~~
++underline with [link](url)++

~~unclosed strikethrough
++unclosed underline

~~empty strikethrough~~
++empty underline++

## Lists Edge Cases

- Simple bullet
* Simple bullet with asterisk
- Bullet with **bold**
- Bullet with *italic*
- Bullet with `code`
- Bullet with [link](url)
- Bullet with - dash inside
- Bullet with * asterisk inside

  - Nested bullet (2 spaces)
    - Double nested (4 spaces)
      - Triple nested (6 spaces)

1. Numbered list item
2. Numbered list item
3. Numbered list item

  1. Nested numbered (3 spaces)
    1. Double nested (6 spaces)
      1. Triple nested (9 spaces)

- Bullet
1. Numbered
- Mixed bullets and numbers
2. In same list

- Bullet with empty line after

- Bullet with multiple lines
  continuing text
  more text

1. Numbered with multiple lines
   continuing text
   more text

- Bullet-no-space (should not match)
*Bullet-no-space (should not match)
1.Numbered-no-space (should not match)

- Bullet with `code` and **bold** and *italic*

## Todo Lists Edge Cases

- [ ] Unchecked todo
- [X] Checked todo uppercase
- [x] Checked todo lowercase
- [ ] Todo with **bold** text
- [X] Checked todo with *italic* text
- [ ] Todo with `code` text
- [ ] Todo with [link](url)

[ ] Todo without bullet (should not match)
- [] Empty todo (should not match)
- [ ] Todo with empty text

- [X] Checked todo that should have strikethrough
- [x] Another checked todo

## Tables Edge Cases

| Header 1 | Header 2 | Header 3 |
|----------|----------|----------|
| Cell 1   | Cell 2   | Cell 3   |
| Cell 4   | Cell 5   | Cell 6   |

| Header with **bold** | Header with *italic* | Header with `code` |
|----------------------|---------------------|-------------------|
| Cell with **bold**   | Cell with *italic*  | Cell with `code`  |

| Incomplete table
| Missing separator
| Cell | Cell |

| Header | Header |
|--------|--------|
| Cell   | Cell   | Extra cell |

| Header |
|--------|
| Cell   |

## Horizontal Rules

---

----

-----

----------------------------------------

   ---   (with spaces)

---text (should not match)
--- (should match)

## Emoji Edge Cases

🎉 Single emoji
🚀🔥💯 Multiple emojis
🎉 emoji with text
text 🎉 emoji
🎉🎉🎉 Repeated emojis

# 🎉 Heading with emoji
**🎉 bold emoji**
*🎉 italic emoji*
`🎉 code emoji`
[🎉 link emoji](url)

- 🎉 Bullet with emoji
1. 🎉 Numbered with emoji
- [ ] 🎉 Todo with emoji

## Arrow Transformations

Text with -> arrow
Text with <- arrow
-> at start
<- at start
-> at end
<- at end

Text->arrow->text
Text<-arrow<-text

-> -> multiple arrows -> ->
<- <- multiple arrows <- <-

## Complex Nested Cases

**bold with *italic* and `code` and [link](url)**
*italic with **bold** and `code` and [link](url)*
`code with **bold** and *italic* and [link](url)` (should not render)

[link with **bold** and *italic* and `code`](https://example.com)

~~strikethrough with **bold** and *italic* and `code` and [link](url)~~
++underline with **bold** and *italic* and `code` and [link](url)++

## Mixed Content Lines

# Heading with - bullet-like text
## Heading with 1. numbered-like text
### Heading with [ ] todo-like text

- Bullet with # heading-like text
- Bullet with 1. numbered-like text
- Bullet with [ ] todo-like text

1. Numbered with # heading-like text
2. Numbered with - bullet-like text
3. Numbered with [ ] todo-like text

## Edge Cases with Special Characters

**bold** with **bold** adjacent
*italic* with *italic* adjacent
`code` with `code` adjacent

**bold**text*bold*text**bold**
*italic*text*italic*text*italic*

**bold** *italic* `code` [link](url) ~~strikethrough~~ ++underline++

## Unicode and Special Characters

Text with émojis 🎉 and accénts
Text with 中文 and русский
Text with 🎉🎉🎉 multiple emojis
Text with →← arrows (Unicode)

## Empty and Whitespace Cases

**   ** (bold with spaces)
*   * (italic with spaces)
`   ` (code with spaces)
[   ](url) (link with spaces)
[text](   ) (link with empty url)

## Code Block Edge Cases

```
Code block with **bold** (should not render)
Code block with *italic* (should not render)
Code block with `inline code` (should not render)
Code block with [link](url) (should not render)
Code block with ~~strikethrough~~ (should not render)
Code block with ++underline++ (should not render)
```

```
Code block
with multiple lines
and special characters -> <-
```

## Real-World Complex Examples

# Project Documentation

## Overview

This is a **complex** markdown document with *many* features.

### Features

- [X] Feature 1: `code` support
- [X] Feature 2: **bold** and *italic*
- [ ] Feature 3: [links](https://example.com)
- [ ] Feature 4: ~~strikethrough~~ and ++underline++

### Code Example

```javascript
function example() {
    return "**bold** should not render";
}
```

### Links

Check out [this link](https://example.com) and [this one](https://example.org).

---

## More Extreme Edge Cases

### Overlapping Patterns

**bold*italic*bold** (overlapping bold and italic)
*bold**italic**bold* (overlapping italic and bold)
`code**bold**code` (code with bold inside, should not render)
`code*italic*code` (code with italic inside, should not render)

### Pattern Boundaries

**bold**text (bold at start of word)
text**bold** (bold at end of word)
*bold*text (italic at start of word)
text*bold* (italic at end of word)

**bold**-**bold** (bold separated by dash)
*bold*-*bold* (italic separated by dash)
**bold**.**bold** (bold separated by period)
*bold*.*bold* (italic separated by period)

### Whitespace Edge Cases

** bold ** (bold with spaces outside)
* italic * (italic with spaces outside)
` code ` (code with spaces outside)

**bold** **bold** (two bolds with space)
*bold* *bold* (two italics with space)
`code` `code` (two codes with space)

### Line Break Edge Cases

**bold
text** (bold across lines - should not match)
*bold
text* (italic across lines - should not match)

### Very Long Content

**This is a very long bold text that spans many characters and should still render correctly as bold text even though it's extremely long and contains many words and characters**

*This is a very long italic text that spans many characters and should still render correctly as italic text even though it's extremely long and contains many words and characters*

`This is a very long code text that spans many characters and should still render correctly as code text even though it's extremely long and contains many words and characters`

### Mixed Delimiters

**bold** and __bold__ on same line
*italic* and _italic_ on same line
**bold** and *italic* and `code` all together
__bold__ and _italic_ and ``code`` all together

### Special Pattern Combinations

**bold**`code`**bold** (bold-code-bold)
*bold*`code`*bold* (italic-code-italic)
`code`**bold**`code` (code-bold-code)
`code`*italic*`code` (code-italic-code)

### List Continuation Edge Cases

- Bullet item
  continuation line
  another continuation

1. Numbered item
   continuation line
   another continuation

- [ ] Todo item
  continuation line
  another continuation

### Table Edge Cases

| **Bold Header** | *Italic Header* | `Code Header` |
|-----------------|-----------------|---------------|
| **Bold Cell**   | *Italic Cell*   | `Code Cell`   |
| [Link](url)     | ~~Strike~~      | ++Underline++ |

| Header | Header |
|--------|--------|
| Cell   |

| One column |
|------------|
| Cell       |

### Code Block Language Tags

```javascript
function test() {
    return "code";
}
```

```python
def test():
    return "code"
```

```markdown
# This is markdown in a code block
**bold** should not render
```

### Arrow Edge Cases in Context

Function: `test() -> result`
Function: `result <- test()`
Math: `x -> y <- z`
Flow: `start -> process -> end`

### Emoji Combinations

🎉🚀🔥💯 Multiple emojis together
🎉 **bold emoji** 🎉
🎉 *italic emoji* 🎉
🎉 `code emoji` 🎉
🎉 [link emoji](url) 🎉

### Very Deep Nesting

**bold with *italic with `code with [link](url)` inside* inside** inside

### Pattern at Document Boundaries

**bold at start**
text at end

start text
**bold at end**

### Empty Document Sections

## Empty Section

### Another Empty Section

---

### Section with Only Whitespace

    

### Section with Only Special Characters

***---+++```[[[]]]((()))***

## Stress Test: All Features Together

# 🎉 **Ultimate** *Test* `Document`

## Features

- [X] **Bold** and *italic* support
- [X] `Code` and ```code blocks```
- [ ] [Links](https://example.com) everywhere
- [ ] ~~Strikethrough~~ and ++underline++

### Code Example

```javascript
function ultimate() {
    return "**bold** should not render";
}
```

### Table

| Feature | Status | Notes |
|---------|--------|-------|
| **Bold** | ✅ | Works |
| *Italic* | ✅ | Works |
| `Code` | ✅ | Works |

---

## Conclusion

This document tests many edge cases and corner cases for markdown rendering.

