# jonisullivan.com

Joni Sullivan's portfolio site, served by GitHub Pages from the `main` branch, with a Squarespace-style
editor at **https://www.jonisullivan.com/admin/**.

Joni edits everything in the browser: text (click and type), images (drag them in from the desktop),
galleries, pages and the menu (drag to reorder), fonts, colors and layout (Site Styles). **Save** publishes;
the change is live about a minute later. Every save is a git commit, so any earlier version can be restored
from **Version History** in the editor.

## First-time setup (Jonah, once)

1. Create a fine-grained token at <https://github.com/settings/personal-access-tokens/new>:
   - Name: `Site editor`, Expiration: **No expiration**
   - Repository access: **Only select repositories** → `jonisullivan.github.io`
   - Repository permissions: **Contents: Read and write**, **Pages: Read-only**
2. Open <https://www.jonisullivan.com/admin/?setup>, paste the token, and keep (or regenerate) the
   five-word password it suggests. It commits `admin/key.json`: the token encrypted with that password.
3. Give Joni the password. She signs in at `/admin`, ticks "Remember me", and never needs it again on that
   computer.

To change the password or replace the token later: sign in, then Settings → Password, or open
`/admin/?setup` again. To cut off access entirely, revoke the token on GitHub.

### Security model, briefly
`admin/key.json` is public but useless without the password: AES-GCM with a key derived by
PBKDF2-SHA256 (1,000,000 iterations). The generated passwords are five words from a 1,024-word list
(about 50 bits). The token can only touch this one repository, and anything it does is a commit that can
be reverted.

## How it works

```
content/site.json          the whole site: pages, sections, menu, design, image list
admin/engine/              renders site.json into pages (shared by the editor and the build script)
  schema.js  render.js  css.js  site.js (published as assets/site.js: menu, lightbox, slideshows, forms)
admin/js/                  the editor (Preact + htm, no build step; vendored in admin/vendor/)
*.html, assets/            GENERATED. Do not edit by hand; they are rebuilt on every save.
images/                    original images; new uploads go to images/uploads/ (plus a 1200px copy)
tools/build.mjs            regenerate the site from site.json (exactly what Save does)
tools/devserver.mjs        local server + mock GitHub API for testing the editor offline
tools/migrate.py           one-time conversion of the old hand-written pages (kept for reference)
tests/engine.test.mjs      tests for the renderer
```

Saving is a single commit made with GitHub's Git Data API from the browser: new images are uploaded as
blobs, every page is rebuilt from `site.json` in the browser, and `main` is moved forward. If the site was
changed elsewhere in the meantime, the editor asks before overwriting anything. Old page addresses keep
working: renaming a page leaves a redirect behind.

## Editing by hand

Change `content/site.json`, then

```bash
node tools/build.mjs
```

and commit. `node tools/build.mjs --check` exits non-zero if the generated files are out of date.

## Running the editor locally

```bash
git clone --bare . /tmp/site-mock.git
node tools/devserver.mjs --port 8790 --site . --repo /tmp/site-mock.git --token test-token-123 --owner jkudlerflam --repo-name jonisullivan.github.io
```

then open <http://127.0.0.1:8790/admin/?token=test-token-123>. Saves go to the mock repository, never to
GitHub. Run the tests with `node --test tests/engine.test.mjs`.
