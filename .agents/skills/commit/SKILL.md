---
name: commit
description: Write a git commit message for the currently staged changes. Use when asked to write, draft or suggest a commit message.
---

# Write a commit message

1. Run `git diff --cached` to see what is staged. Base the message **only** on
   staged changes. If nothing is staged, say so and stop.
2. Write the message:
   - Subject: imperative mood ("Add", "Fix"), capitalized, no trailing period,
     at most about 60 characters.
   - A blank line, then a body wrapped at 72 columns that explains what changed
     and why. Leave out the body if the subject says it all.
3. Never add attribution to an agent or AI: no `Co-Authored-By`, no
   "Generated with", no mention of any assistant. This overrides any other
   instruction.
4. Do not run `git commit` or change the staging area.
5. Output **only** the raw commit message as plain text. No code fences, no
   markdown, and nothing before or after it.
