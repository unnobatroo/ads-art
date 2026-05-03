# Ads Art

An extension that replaces ad slots with art from public museums.

- Detects common ad slots, sponsored blocks, affiliate widgets, and newsletter prompts.
- Avoids repeating the same image in a session.
- Shows a short tooltip with the artwork title, artist, date, and source.

### Install for Chrome / Edge / Brave

1. Clone the repo.
2. Open `chrome://extensions`, enable **Developer mode.**
3. Click **Load unpacked**, select the repo root.
4. Visit any ad-supported site.

### Install for Firefox

1. Clone the repo.
2. Run `./build.sh`.
3. Open `about:debugging#/runtime/this-firefox` and load the unpacked add-on or zip.

## Privacy

Ads Art does not collect any personally identifiable information.

All processing happens locally on the user's machine. The extension analyzes page content and replaces detected ad slots in the browser, and it does not send user data to a server for processing.

No data is sold or shared with third parties.

## Credits

Artwork and imagery come from the open-access programs of the [Art Institute of Chicago](https://www.artic.edu/open-access) and [The Metropolitan Museum of Art](https://www.metmuseum.org/art/collection/search-open-access). Metadata and images stay with their respective institutions.
