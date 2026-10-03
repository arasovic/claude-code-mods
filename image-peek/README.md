# image-peek

Shows the images you paste into Claude Code. A `[Image #1]` tag in the prompt becomes a picture you can see, before you send it and after.

## What it shows

- **Above the prompt, while you write:** a row of thumbnails, one per `[Image #n]` tag in the draft, labelled with its number. They keep their shape and shrink to fit the terminal's width. The row goes away when you send the prompt or delete the tags.

  ![Thumbnails of two pasted images above the prompt](../docs/image-peek-draft.png)

- **In the chat, after you send:** the same pictures under your message, larger: up to the terminal's width and half its height. Several pictures share one row.

  ![The same two images, larger, under the sent message](../docs/image-peek.png)

## Limits

- Pictures need a terminal with the kitty graphics protocol, such as Ghostty or kitty. Other terminals show the `[Image #n]` text in the frame.
- Only PNG images. Claude Code saves pasted images as PNG, so a paste always qualifies.
- The mod draws from the copy Claude Code keeps in its temporary folder (`/tmp/claude-<uid>/<project>/<session>/images`) and keeps no copy of its own. When that folder is gone, for example after the computer restarts, older messages show only their tag.
- Claude Code does not document that folder. If an update moves it, the pictures stop showing, without an error.
- Pasting raises no event a mod can hook, so the mod reads the draft four times a second.
- The Claude desktop app shows pasted images itself; the mod draws only in the terminal.

## Install

```sh
claude plugin marketplace add arasovic/claude-code-mods
claude plugin install image-peek@claude-code-mods
```

Restart Claude Code, then paste an image into the prompt.

## Develop

```sh
claude plugin validate .
claude plugin test .
../typecheck.sh image-peek
```
