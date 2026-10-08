import { describe, it, expect } from 'vitest';
import sanitizeHtmlDefault, { sanitizeHtml } from './sanitize';

// Re-parse the output the way dangerouslySetInnerHTML would and inspect the DOM
const render = (html) => {
  const container = document.createElement('div');
  container.innerHTML = sanitizeHtml(html);
  return container;
};

const hasEventHandlers = (container) =>
  Array.from(container.querySelectorAll('*')).some(el =>
    Array.from(el.attributes).some(attr => attr.name.toLowerCase().startsWith('on'))
  );

describe('sanitizeHtml - input handling', () => {
  it('is also the default export', () => {
    expect(sanitizeHtmlDefault).toBe(sanitizeHtml);
  });

  it.each([null, undefined, '', 0, 42, {}, [], true])('returns "" for empty / non-string input (%s)', (input) => {
    expect(sanitizeHtml(input)).toBe('');
  });

  it('passes plain text through, escaping markup characters', () => {
    expect(sanitizeHtml('שלום עולם')).toBe('שלום עולם');
    expect(sanitizeHtml('a &lt;b&gt; c')).toBe('a &lt;b&gt; c');
    expect(sanitizeHtml('1 < 2 && 3 > 2')).toBe('1 &lt; 2 &amp;&amp; 3 &gt; 2');
  });
});

describe('sanitizeHtml - XSS payloads are neutralised', () => {
  it('removes event handler attributes from images', () => {
    const container = render('<img src=x onerror=alert(1)>');
    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    expect(img.hasAttribute('onerror')).toBe(false);
    expect(hasEventHandlers(container)).toBe(false);
  });

  it('removes event handlers on every allowed tag', () => {
    const container = render(
      '<p onclick="alert(1)">x</p><a href="https://example.com" onmouseover="alert(1)">y</a>' +
      '<div onload="alert(1)"><span onfocus="alert(1)" tabindex="0">z</span></div>'
    );
    expect(hasEventHandlers(container)).toBe(false);
    expect(container.textContent).toBe('xyz');
  });

  it('removes <script> elements entirely (including their text)', () => {
    const container = render('<p>hi</p><script>alert(1)</script><p>bye</p>');
    expect(container.querySelector('script')).toBeNull();
    expect(container.textContent).toBe('hibye');
  });

  it('removes nested <script> elements', () => {
    const container = render('<div><p><strong><script>alert(1)</script>ok</strong></p></div>');
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('strong').textContent).toBe('ok');
  });

  it.each([
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    '  javascript:alert(1)',
    'java\tscript:alert(1)',
    'java\nscript:alert(1)',
    '\u0001javascript:alert(1)',
    'vbscript:msgbox(1)',
    'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=='
  ])('strips dangerous link href %j', (href) => {
    const container = document.createElement('div');
    const a = document.createElement('a');
    a.setAttribute('href', href);
    a.textContent = 'click';
    container.appendChild(a);

    const out = render(container.innerHTML);
    const link = out.querySelector('a');
    expect(link).not.toBeNull();
    expect(link.hasAttribute('href')).toBe(false);
    expect(link.textContent).toBe('click');
  });

  it('strips entity-obfuscated javascript: URLs', () => {
    const container = render('<a href="&#106;avascript&#58;alert(1)">x</a><a href="java&#x09;script:alert(1)">y</a>');
    container.querySelectorAll('a').forEach(a => expect(a.hasAttribute('href')).toBe(false));
  });

  it.each([
    'javascript:alert(1)',
    'data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+',
    'data:text/html,<script>alert(1)</script>',
    ' data:text/html;base64,AAAA',
    'vbscript:x'
  ])('strips dangerous image src %j', (src) => {
    const holder = document.createElement('div');
    const img = document.createElement('img');
    img.setAttribute('src', src);
    holder.appendChild(img);

    const out = render(holder.innerHTML);
    expect(out.querySelector('img').hasAttribute('src')).toBe(false);
  });

  it.each([
    ['iframe', '<iframe src="https://evil.example"></iframe>'],
    ['object', '<object data="x.swf"></object>'],
    ['embed', '<embed src="x.swf">'],
    ['svg', '<svg onload="alert(1)"><circle r="1"/></svg>'],
    ['math', '<math><mtext><table><mglyph><style><img src=x onerror=alert(1)></style></mglyph></table></mtext></math>'],
    ['style', '<style>body{background:url(javascript:alert(1))}</style>'],
    ['form', '<form action="https://evil.example"><input name="password"><button formaction="javascript:alert(1)">go</button></form>'],
    ['meta', '<meta http-equiv="refresh" content="0;url=javascript:alert(1)">'],
    ['link', '<link rel="stylesheet" href="https://evil.example/x.css">'],
    ['base', '<base href="https://evil.example/">'],
    ['template', '<template><img src=x onerror=alert(1)></template>'],
    ['noscript', '<noscript><p title="</noscript><img src=x onerror=alert(1)>"></noscript>']
  ])('removes disallowed <%s> elements', (tag, html) => {
    const container = render(html);
    expect(container.querySelector(tag)).toBeNull();
    expect(container.querySelector('img[onerror], script, iframe, svg, math, style, form, input, button')).toBeNull();
    expect(hasEventHandlers(container)).toBe(false);
  });

  it('removes inline styles and unknown attributes', () => {
    const container = render(
      '<p style="background:url(javascript:alert(1))" data-x="1" id="hijack" contenteditable="true">x</p>'
    );
    const p = container.querySelector('p');
    expect(Array.from(p.attributes).map(a => a.name)).toEqual([]);
  });

  it('removes srcset / xlink:href / formaction style URL attributes', () => {
    const container = render(
      '<img src="https://ok.example/a.png" srcset="javascript:alert(1) 1x">' +
      '<a href="https://ok.example" xlink:href="javascript:alert(1)" ping="https://track.example">x</a>'
    );
    expect(container.querySelector('img').getAttributeNames()).toEqual(['src']);
    expect(container.querySelector('a').getAttributeNames().sort()).toEqual(['href', 'rel', 'target']);
  });

  it('does not produce executable markup after a second parse (mutation XSS)', () => {
    const payloads = [
      '<a title="</a><img src=x onerror=alert(1)>">x</a>',
      '<p class="x" title="<script>alert(1)</script>">y</p>',
      '<!--<img src=x onerror=alert(1)>-->',
      '<div><svg></p><style><a id="</style><img src=1 onerror=alert(1)>"></svg></div>'
    ];
    payloads.forEach(payload => {
      const once = render(payload);
      const twice = document.createElement('div');
      twice.innerHTML = sanitizeHtml(once.innerHTML);
      [once, twice].forEach(c => {
        expect(c.querySelector('script, svg, style')).toBeNull();
        expect(hasEventHandlers(c)).toBe(false);
      });
    });
  });
});

describe('sanitizeHtml - legitimate rich text survives', () => {
  it('keeps the formatting the notes editor (Quill) produces', () => {
    const html =
      '<h1>כותרת</h1>' +
      '<p class="ql-align-right ql-direction-rtl"><strong>מודגש</strong> <em>נטוי</em> <u>קו תחתון</u> <s>מחוק</s></p>' +
      '<ol><li>אחד</li><li class="ql-indent-1">שניים</li></ol>' +
      '<ul><li>נקודה</li></ul>' +
      '<blockquote>ציטוט</blockquote>' +
      '<pre class="ql-syntax">const a = 1;</pre>' +
      '<p>x<sub>2</sub> y<sup>3</sup><br></p>';
    expect(sanitizeHtml(html)).toBe(html);
  });

  it('keeps dir and class attributes for RTL / alignment', () => {
    const container = render('<p dir="rtl" class="ql-align-center">טקסט</p>');
    const p = container.querySelector('p');
    expect(p).toHaveAttribute('dir', 'rtl');
    expect(p).toHaveClass('ql-align-center');
  });

  it.each([
    'https://example.com/page?q=1#x',
    'http://example.com',
    'mailto:someone@example.com',
    'tel:+972501234567',
    '/relative/path',
    '#anchor'
  ])('keeps safe link href %j', (href) => {
    const container = render(`<a href="${href}" title="t">link</a>`);
    const a = container.querySelector('a');
    expect(a.getAttribute('href')).toBe(href);
    expect(a).toHaveAttribute('title', 't');
  });

  it('forces links to open in a new tab without opener / referrer', () => {
    const container = render('<a href="https://example.com" target="_self" rel="opener">x</a>');
    const a = container.querySelector('a');
    expect(a).toHaveAttribute('target', '_blank');
    expect(a).toHaveAttribute('rel', 'noopener noreferrer nofollow');
  });

  it('keeps http(s) images and base64 raster data URIs with their size attributes', () => {
    const png = 'data:image/png;base64,iVBORw0KGgo=';
    const container = render(
      `<img src="https://cdn.example/a.jpg" alt="תמונה" width="100" height="50">` +
      `<img src="${png}">` +
      `<img src="data:image/JPEG;base64,/9j/4AAQ">`
    );
    const imgs = container.querySelectorAll('img');
    expect(imgs[0]).toHaveAttribute('src', 'https://cdn.example/a.jpg');
    expect(imgs[0]).toHaveAttribute('alt', 'תמונה');
    expect(imgs[0]).toHaveAttribute('width', '100');
    expect(imgs[0]).toHaveAttribute('height', '50');
    expect(imgs[1]).toHaveAttribute('src', png);
    expect(imgs[2]).toHaveAttribute('src', 'data:image/JPEG;base64,/9j/4AAQ');
  });

  it('keeps text from removed wrappers out, but keeps siblings', () => {
    const container = render('<p>before</p><iframe>inner</iframe><p>after</p>');
    expect(container.textContent).toBe('beforeafter');
  });

  it('handles mixed Hebrew / English content and entities', () => {
    expect(sanitizeHtml('<p>שלום &amp; hello&nbsp;world</p>')).toBe('<p>שלום &amp; hello&nbsp;world</p>');
  });
});
