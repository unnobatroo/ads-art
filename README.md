# Ads Art

An extension that replaces ad slots with art from public museum and NASA collections.

- Detects common ad slots, sponsored blocks, affiliate widgets, and newsletter prompts
- Lets you pick art from the main collections or nasa only
- Avoids repeating the same image in a session
- Shows a short tooltip with the artwork title, artist, date, and source
- Tracks replaced slots per tab in the toolbar badge

## Install for Chrome / Edge / Brave

1. Clone the repo
2. Open `chrome://extensions`, enable **Developer mode**
3. Click **Load unpacked**, select the repo root
4. Visit any ad-supported site

## Install for Firefox

1. Clone the repo
2. Run `./build.sh`
3. Open `about:debugging#/runtime/this-firefox` and load the unpacked add-on or zip

### Privacy

Ads Art collects nothing. It does not use analytics, accounts, telemetry, or browsing history. The only outbound requests go to the public museum and NASA API's with a generic search term.

### Credits

Artwork and imagery come from the open-access programs of the [Art Institute of Chicago](https://www.artic.edu/open-access), [The Metropolitan Museum of Art](https://www.metmuseum.org/art/collection/search-open-access), and [NASA](https://images.nasa.gov). Metadata and images stay with their respective institutions.
