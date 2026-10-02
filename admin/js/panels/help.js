// Help panel (website mode): short how-to articles as an accordion, plus the
// keyboard shortcuts. Written for Joni, in the editor's own words.

import { html, useState, Icon } from '../ui.js';
import { setState } from '../store.js';
import { SideHead } from '../app.js';

// A link-style button that opens another panel of the editor.
const go = (panel, label) => html`<button type="button" class="linkbtn" onClick=${() => setState({ sidePanel: panel })}>${label}</button>`;

const ARTICLES = [
  {
    id: 'text',
    title: 'Edit text',
    body: () => html`
      <ol>
        <li>Click <b>EDIT</b> at the top left of the page.</li>
        <li>Click any text and type. A toolbar appears above it with the text styles (Heading 1 to 4, Paragraph 1 to 3), bold, italic, links, color, alignment and lists.</li>
        <li>Click <b>Save</b> when you're done.</li>
      </ol>
      <p>Captions work the same way. Click under an image in Edit mode and type.</p>`,
  },
  {
    id: 'gallery',
    title: 'Add images to a gallery',
    body: () => html`
      <p>In Edit mode, drag photos from your computer straight onto a gallery on the page.</p>
      <p>Or point at the gallery and click <b>EDIT GALLERY</b>. Click the <b>+</b> tile, then choose <b>Upload Images</b> for new photos, or <b>Search Images</b> to pick ones already in your ${go('media', 'Asset Library')}. Drag the images in the panel to put them in a different order.</p>
      <p>To change how the gallery looks (a grid, a slideshow and so on), click <b>EDIT SECTION</b> and open the Gallery tab.</p>
      <p>Tip: name files like <i>Title_Medium_Size_Year.jpg</i> (for example <i>Night Garden_Oil on linen_24x30_2025.jpg</i>) and the caption is written for you.</p>`,
  },
  {
    id: 'replace',
    title: 'Replace, hide or remove an image',
    body: () => html`
      <ul>
        <li>In a gallery, click <b>EDIT GALLERY</b> and click the image. There you can replace it, hide it, and change its description and link. The trash icon on an image removes it from the gallery, and Undo brings it back.</li>
        <li>A hidden image stays in the editor (faded) but isn't shown on your live site.</li>
        <li>For a single image on a page, drag a new photo from your computer onto it, or click the image and choose <b>Replace image</b>.</li>
      </ul>
      <p>To swap an image on every page at once, open the ${go('media', 'Asset Library')}, click the image, and choose <b>Replace everywhere</b>.</p>`,
  },
  {
    id: 'page',
    title: 'Add a page',
    body: () => html`
      <ol>
        <li>Open ${go('pages', 'Pages')} and click <b>+</b> next to Main Navigation. (Use the <b>+</b> next to Not Linked for a page that isn't in the menu.)</li>
        <li>Choose <b>Page</b>, type a title, pick a starting layout and click <b>Add page</b>.</li>
      </ol>
      <p>The gear icon next to a page opens its settings, with the title, the web address, a switch to hide the page without deleting it, and Duplicate. The magnifying glass at the top of Pages finds a page by its title or web address.</p>`,
  },
  {
    id: 'deleted',
    title: 'Delete a page and get it back',
    body: () => html`
      <ol>
        <li>In ${go('pages', 'Pages')}, point at a page and click the trash icon.</li>
        <li>The page waits in <b>Deleted Pages</b>, at the bottom of the Pages panel, for 30 days.</li>
        <li>Click <b>Restore</b> to bring it back. It returns to Not Linked, and you can drag it into the menu.</li>
      </ol>`,
  },
  {
    id: 'article',
    title: 'Write a new article',
    body: () => html`
      <ol>
        <li>Open ${go('pages', 'Pages')} and click your article collection (for example Art Writing).</li>
        <li>Click <b>+</b> at the top. A new article opens, with its Article settings.</li>
        <li>Fill in the title, date, short excerpt and thumbnail, then write the article on the page.</li>
        <li>When it's ready, switch on <b>Published</b> in Article settings (the gear next to the article) and click <b>Save</b>.</li>
      </ol>
      <p>Until it's published, an article is a draft that only you can see in the editor.</p>`,
  },
  {
    id: 'menu',
    title: 'Rearrange the menu and use dropdowns',
    body: () => html`
      <ul>
        <li>In ${go('pages', 'Pages')}, drag pages up or down to change their order in the menu.</li>
        <li>For a dropdown, click <b>+</b> next to Main Navigation, choose <b>Dropdown</b>, then drag pages onto it.</li>
        <li>Drag a page down to Not Linked to take it out of the menu without deleting it.</li>
      </ul>`,
  },
  {
    id: 'section',
    title: 'Add and style a section',
    body: () => html`
      <ol>
        <li>In Edit mode, point at a section and click <b>ADD SECTION</b> above or below it.</li>
        <li>Click <b>+ Add Blank</b> for an empty section that you fill with blocks, or pick a ready-made layout from the list. Sections you saved are under <b>Saved</b>.</li>
        <li>Click <b>EDIT SECTION</b> to change its height and width, its background (a color or an image) and its colors.</li>
      </ol>
      <p>The heart in a section's toolbar saves it so you can add it again later. The arrows move a section up or down.</p>`,
  },
  {
    id: 'blocks',
    title: 'Add and arrange blocks',
    body: () => html`
      <ol>
        <li>In Edit mode, point at a section and click <b>+ ADD BLOCK</b> at its top. Search, or pick Text, Image, Button, Line, Quote, Video, Code, Form, Social Links, Map or Accordion.</li>
        <li>Drag a block to move it, and drag its corners and edges to resize it. In a text block, a click puts the cursor where you click, and a drag moves the block.</li>
        <li>Click a block to see its toolbar. It edits the block, lines up what is inside, shows all the blocks in a section (Layers), duplicates the block or deletes it.</li>
      </ol>
      <p>Press <kbd class="md-kbd">G</kbd> to keep the grid showing while you work. Right-click a block for more, such as hiding it on phones. Phones have their own arrangement, so click the phone icon to change how a page stacks on a small screen.</p>`,
  },
  {
    id: 'design',
    title: 'Change fonts, colors and styles',
    body: () => html`
      <p>Click the brush (Site Styles) at the top right, or <b>Design</b> in the main menu.</p>
      <ul>
        <li><b>Themes</b> changes the fonts, colors and buttons together.</li>
        <li><b>Fonts</b>, <b>Colors</b> and <b>Buttons</b> change each of those on its own.</li>
        <li><b>Animations</b> makes sections fade or slide in as people scroll, and <b>Spacing</b> sets the header layout and the margins.</li>
      </ul>
      <p>The page updates as you go, and the arrows at the top of the panel undo and redo. In Edit mode, click <b>Save</b> to publish the new look.</p>`,
  },
  {
    id: 'phone',
    title: 'Preview on a phone',
    body: () => html`<p>Click the phone icon at the top right to see the page the way it looks on a phone. Click the screen icon next to it to go back. You can keep editing in either view.</p>`,
  },
  {
    id: 'undo',
    title: 'Undo a mistake',
    body: () => html`
      <p>Press <kbd class="md-kbd">⌘Z</kbd>, or click the curved arrow at the top of the editor in Edit mode. <kbd class="md-kbd">⇧⌘Z</kbd> brings the change back.</p>
      <p>Haven't saved yet? Click <b>Exit</b> and choose <b>Discard changes</b> to go back to the last saved version.</p>`,
  },
  {
    id: 'versions',
    title: 'Go back to an older version',
    body: () => html`
      <ol>
        <li>Open ${go('history', 'Version History')}. Every save is listed, newest first.</li>
        <li>Click a save to look at it. Nothing changes yet.</li>
        <li>Click <b>Restore this version</b> to publish it, or <b>Back to current</b>.</li>
      </ol>
      <p>The version you replace stays in the list, so you can always switch back.</p>`,
  },
  {
    id: 'saving',
    title: 'Saving and publishing',
    body: () => html`
      <p>In Edit mode, click <b>Save</b> (or press <kbd class="md-kbd">⌘S</kbd>). Your changes are published to your website and go live in about a minute. The top bar says <i>Saved and live</i> when they're up.</p>
      <p>Changes made outside Edit mode, in Pages, Site Styles, Settings and the Asset Library, save on their own.</p>
      <p>If the browser closes before you save, your changes are kept on this computer and offered back the next time you open the editor.</p>`,
  },
  {
    id: 'form',
    title: 'Set up the contact form',
    body: () => html`
      <ol>
        <li>Make a free account at <a href="https://formspree.io" target="_blank" rel="noopener">formspree.io</a> and create a form.</li>
        <li>Copy the form's address and paste it into ${go('settings', 'Settings')}, under Contact form.</li>
        <li>In Edit mode, click <b>ADD SECTION</b> where you want the form, open the <b>Contact</b> category and choose <b>Contact form</b>.</li>
      </ol>
      <p>Messages people send arrive in your email.</p>`,
  },
  {
    id: 'heic',
    title: 'Photos from an iPhone (HEIC)',
    body: () => html`
      <p>iPhones often save photos as HEIC, which websites can't show. Export them as JPEG first:</p>
      <ul>
        <li>On a Mac, open the photo in Preview, choose File → Export, pick JPEG and save.</li>
        <li>Or in Photos, choose File → Export → Export 1 Photo and pick JPEG.</li>
        <li>To make your iPhone take JPEGs from now on: Settings → Camera → Formats → Most Compatible.</li>
      </ul>
      <p>Big photos are fine. The editor resizes them for the web.</p>`,
  },
  {
    id: 'wrong',
    title: 'If something looks wrong',
    body: () => html`
      <ul>
        <li>Try Undo (<kbd class="md-kbd">⌘Z</kbd>) first.</li>
        <li>Reload the page in your browser. Unsaved changes are kept and offered back.</li>
        <li>To return to how things were earlier, use ${go('history', 'Version History')}.</li>
      </ul>
      <p>Still stuck? Ask Jonah. Say which page you were on and what you clicked. A screenshot helps.</p>`,
  },
];

const SHORTCUTS = [
  ['⌘Z', 'Undo'],
  ['⇧⌘Z', 'Redo'],
  ['⌘S', 'Save'],
  ['⌘B', 'Bold'],
  ['⌘I', 'Italic'],
  ['⌘K', 'Add a link to the selected text'],
  ['⇧⌘L, ⇧⌘E, ⇧⌘R', 'Align text left, center or right'],
  ['⌥⌘1 to ⌥⌘6', 'Paragraph and heading styles (⌥⌘6 is Heading 1)'],
  ['⇧⌘V', 'Paste without formatting'],
  ['Esc', 'Close a panel, or stop editing text'],
  ['Tab', 'Select the next block (⇧Tab for the previous one)'],
  ['⌘A', 'Select every block in the section'],
  ['Arrow keys', 'Move the selected block (hold ⇧ to move farther)'],
  ['⌘ and arrow keys', 'Resize the selected block'],
  ['⌘D', 'Duplicate the selected block'],
  ['⌘C, ⌘V', 'Copy and paste blocks, also into another section'],
  ['⇧⌘H', 'Hide the selected block on this screen size'],
  ['Delete', 'Delete the selected block'],
  ['G', 'Show or hide the grid'],
];

export function HelpPanel() {
  const [open, setOpen] = useState(null);
  return html`<aside class="side md-side">
    <${SideHead} title="Help" />
    <div class="side-scroll"><div class="md-body">
      <p class="md-lead">Quick answers to common questions. Click a topic to open it.</p>
      <ul class="md-acc">
        ${ARTICLES.map(a => {
          const on = open === a.id;
          return html`<li key=${a.id} class=${on ? 'open' : ''}>
            <button type="button" aria-expanded=${on ? 'true' : 'false'} onClick=${() => setOpen(on ? null : a.id)}>
              <span>${a.title}</span><${Icon} name="chevD" size=${16} />
            </button>
            ${on ? html`<div class="md-acc-body">${a.body()}</div>` : null}
          </li>`;
        })}
      </ul>

      <div class="subhead">Keyboard shortcuts</div>
      <table class="md-keys">
        <tbody>
          ${SHORTCUTS.map(([k, what]) => html`<tr><td><kbd class="md-kbd">${k}</kbd></td><td>${what}</td></tr>`)}
        </tbody>
      </table>
      <p class="md-help">On a Windows computer, use Ctrl instead of ⌘.</p>
      <p class="note md-note"><${Icon} name="help" size=${15} /> Still stuck? Ask Jonah.</p>
    </div></div>
  </aside>`;
}
