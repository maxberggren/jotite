# Markdown Feature Test Document

This document tests all the **Slack-grade** markdown rendering features!

## Text Formatting

Here we have **bold text** and *italic text* and even ***bold italic*** text.

We can also use __underscores for bold__ and _underscores for italic_.

### Inline Code

Variables like `myVariable` and functions like `getUserData()` should have nice styling.

You can also reference file paths like `/home/user/documents` and commands like `sudo apt install`.

#### Strikethrough

This is ~~wrong~~ correct! Here's ~~another mistake~~ the right answer.

##### Links

Check out [GitHub](https://github.com) or visit [my website](https://example.com) for more info.

Here's a link with **bold text**: [**Important Link**](https://important.com)

###### Code Blocks

Here's a JavaScript code block:

```
function helloWorld() {
  console.log("Hello, World!");
  return true;
}
```

And here's a Python example:

```
def calculate_sum(a, b):
    result = a + b
    return result

print(calculate_sum(5, 3))
```

## Lists and Bullets

- First item with `inline code`
- Second item with **bold text**
- Third item with *italic text*
- Fourth item with a [link](https://example.com)

Here's more complex content:

- Item with ~~strikethrough~~
- Item with ***bold and italic***
- Item with `code` and **bold** together

## Complex Combinations

You can have **bold with `code` inside** and *italic with `code` too*.

Here's a sentence with ~~strikethrough `code`~~ and **bold _italic_ text**.

Links can be styled: [**Bold Link**](https://example.com) or [*Italic Link*](https://test.com)

### Real World Example

In JavaScript, you might write: `const apiUrl = 'https://api.example.com'`

Then make a request like:

```
async function fetchData() {
  const response = await fetch(apiUrl);
  const data = await response.json();
  return data;
}
```

The function returns **JSON data** from the *API endpoint*.

### Edge Cases

- **Bold at start** of line
- *Italic at start* of line
- `Code at start` of line
- ~~Strike at start~~ of line

Middle **bold** text here.
Middle *italic* text here.
Middle `code` text here.
Middle ~~strike~~ text here.

**Bold at end**
*Italic at end*
`Code at end`
~~Strike at end~~

## Nested and Complex

Here's **bold with *italic inside* and `code`** all together!

And *italic with **bold inside** and `code`* works too!

You can even have `code with **bold syntax** inside` but it stays monospace.

### Special Characters

Test with special chars: **hello-world** and *test_file* and `some-variable-name`.

Links with paths: [docs/readme.md](https://example.com/docs/readme.md)

## Multi-line Content

This is a paragraph with **bold**, *italic*, `code`, and ~~strikethrough~~ all in one.

Another paragraph testing [links](https://test.com) with **formatting** and *styles*.

```
# This is a code block
# With multiple lines
# Including comments

def process_data(input_data):
    # Process the data
    result = transform(input_data)
    return result
```

Back to regular text with `inline code` and **bold formatting**.

## Summary

We've tested:
- All **6 header levels** (H1 through H6)
- **Bold** and *italic* text
- `Inline code` elements
- ~~Strikethrough~~ text
- [Links](https://example.com)
- Bullet point lists
- Multi-line code blocks with ```triple backticks```
- Complex combinations and nesting

Everything should render beautifully with **Slack-style** formatting! 🎨
