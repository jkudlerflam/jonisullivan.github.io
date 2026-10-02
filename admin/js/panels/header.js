// Edit Site Header and Edit Footer, modeled on Squarespace 7.1. They open from
// the EDIT SITE HEADER / EDIT FOOTER buttons that appear over the preview.

import { html, useState, Icon, Field, TextInput, Toggle, ImageField, FloatingPanel } from '../ui.js';
import { useStore, setState, updateSite } from '../store.js';
import { LayoutCards, SliderField } from './design.js';

// ---------- Site Header ----------

export function HeaderPanel({ onClose }) {
  const settings = useStore(s => s.site.settings);
  const logoId = useStore(s => s.site.design.logo?.media || null);
  const hasLogo = useStore(s => !!(s.site.design.logo?.media && s.site.media[s.site.design.logo.media]));
  const setTitle = v => updateSite(site => { site.settings.headerTitle = v; }, { label: 'site title', coalesce: 'header-title' });
  const setLogo = id => updateSite(site => {
    site.design.logo = { ...(site.design.logo || {}), media: id || null };
  }, { label: id ? 'logo' : 'remove logo' });
  return html`<${FloatingPanel} title="Site Header" onClose=${onClose}>
    <div class="st-panel st-view-header">
      <div class="subhead">Layout</div>
      <${LayoutCards} />

      <div class="subhead">Site title</div>
      <${Field} help=${hasLogo ? 'Not shown while you use a logo. Press Return to start a new line.' : 'Press Return to start a new line, for example to put your first and last name on two lines.'}>
        <${TextInput} multiline rows=${2} value=${settings.headerTitle} placeholder=${settings.siteName} onChange=${setTitle} aria-label="Site title" />
      <//>
      ${!hasLogo ? html`
        <${SliderField} label="Title size" path="title.size" min=${10} max=${80} undo="site title size" />
        <${SliderField} label="Letter spacing" path="title.letterSpacing" min=${-0.05} max=${0.6} step=${0.01} unit="em" undo="site title letter spacing" />` : null}

      <div class="subhead">Logo</div>
      <${Field} help="A logo image replaces the site title text in the header.">
        <${ImageField} value=${hasLogo ? logoId : null} onChange=${setLogo} />
      <//>
      ${hasLogo ? html`<${SliderField} label="Logo height" path="logo.height" min=${16} max=${200} undo="logo height" help="On phones the logo is shown a little smaller." />` : null}

      <div class="st-foot">
        <button type="button" class="linkbtn st-more" onClick=${() => setState({ stylesOpen: true, stylesView: 'title', editPanel: null })}>More styles <${Icon} name="chevR" size=${14} /></button>
        <p class="help">Font, weight, italic and phone sizes for the title are in Site Styles.</p>
      </div>
    </div>
  <//>`;
}

// ---------- Footer ----------

// The footer is stored as inline HTML (strong, em, a and br). The text box
// shows it as plain text; what is typed there is escaped, with line breaks.
export function textToHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\r?\n/g, '<br>');
}

export function htmlToText(markup) {
  return String(markup ?? '')
    .replace(/\s*<br\s*\/?>\s*/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6])>\s*<(p|div|li|h[1-6])\b[^>]*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (m, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, '&');
}

// Formatting the plain text box cannot show (anything other than line breaks).
const hasFormatting = markup => /<(?!br\b)[a-z]/i.test(markup || '');

// The text a hidden footer had, so turning it back on restores it.
let hiddenFooter = '';

export function FooterPanel({ onClose }) {
  const footer = useStore(s => s.site.settings.footer || '');
  const siteName = useStore(s => s.site.settings.siteName || '');
  // Keeps the text box open while the text is emptied to be retyped.
  const [keepOpen, setKeepOpen] = useState(false);
  const on = !!footer || keepOpen;
  const example = `© ${new Date().getFullYear()} ${siteName}`.trim();
  const write = (value, label, coalesce = null) => updateSite(site => { site.settings.footer = value; }, { label, coalesce });
  const toggle = show => {
    setKeepOpen(false);
    if (show) {
      if (!footer) write(hiddenFooter || textToHtml(example), 'show footer');
    } else if (footer) {
      hiddenFooter = footer;
      write('', 'hide footer');
    }
  };
  const type = v => {
    setKeepOpen(true);
    const text = v.trim();
    write(text ? textToHtml(text) : '', 'footer text', 'footer-text');
  };
  return html`<${FloatingPanel} title="Footer" onClose=${onClose}>
    <div class="st-panel st-view-footer">
      <${Toggle} label="Show a footer" help="A line of text at the bottom of every page." checked=${on} onChange=${toggle} />
      ${on ? html`
        <${Field} label="Footer text" help="Press Return to start a new line.">
          <${TextInput} multiline rows=${3} value=${htmlToText(footer)} placeholder=${example} onChange=${type} aria-label="Footer text" />
        <//>
        ${hasFormatting(footer) ? html`<p class="note warn">Your footer has bold, italic or a link. Typing here removes that formatting. To keep it, edit the footer on the page instead.</p>` : null}
        <p class="note">You can also click the footer at the bottom of the page and type there. The text toolbar there adds bold, italic and links.</p>`
      : html`<p class="note">Turn this on to add a line such as "${example}" at the bottom of every page. You can then edit it here or directly on the page.</p>`}
    </div>
  <//>`;
}
