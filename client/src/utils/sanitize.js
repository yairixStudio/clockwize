// Allow-list based HTML sanitizer for rich-text content (notes editor).
// Note bodies are stored verbatim by the server, so anything rendered with
// dangerouslySetInnerHTML must pass through here first.

// Tags the notes editor can produce, plus common equivalents
const ALLOWED_TAGS = new Set([
  'p', 'br', 'hr', 'div', 'span',
  'strong', 'b', 'em', 'i', 'u', 's', 'strike', 'del', 'ins', 'sub', 'sup',
  'blockquote', 'pre', 'code',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ol', 'ul', 'li', 'a', 'img'
]);

const GLOBAL_ATTRS = new Set(['class', 'dir']);

const TAG_ATTRS = {
  a: new Set(['href', 'title']),
  img: new Set(['src', 'alt', 'title', 'width', 'height'])
};

const SAFE_PROTOCOLS = ['http:', 'https:', 'mailto:', 'tel:'];
const SAFE_IMAGE_DATA_URI = /^data:image\/(png|jpe?g|gif|webp|bmp);base64,/i;

// URL parsing normalises the scheme, so javascript:/data:/vbscript: links
// are rejected even when obfuscated with control characters
const getProtocol = (value) => {
  try {
    return new URL(value, window.location.origin).protocol;
  } catch {
    return null;
  }
};

const isSafeHref = (value) => SAFE_PROTOCOLS.includes(getProtocol(value));

// Images pasted into the editor are inlined as base64 data URIs
const isSafeSrc = (value) => {
  if (SAFE_IMAGE_DATA_URI.test(value.trim())) return true;
  const protocol = getProtocol(value);
  return protocol === 'http:' || protocol === 'https:';
};

const sanitizeElement = (element) => {
  Array.from(element.children).forEach(child => {
    const tag = child.tagName.toLowerCase();

    if (!ALLOWED_TAGS.has(tag)) {
      child.remove();
      return;
    }

    Array.from(child.attributes).forEach(attr => {
      const name = attr.name.toLowerCase();
      const isAllowed = GLOBAL_ATTRS.has(name) || TAG_ATTRS[tag]?.has(name);
      if (!isAllowed
        || (name === 'href' && !isSafeHref(attr.value))
        || (name === 'src' && !isSafeSrc(attr.value))) {
        child.removeAttribute(attr.name);
      }
    });

    if (tag === 'a') {
      child.setAttribute('target', '_blank');
      child.setAttribute('rel', 'noopener noreferrer nofollow');
    }

    sanitizeElement(child);
  });
};

export const sanitizeHtml = (html) => {
  if (!html || typeof html !== 'string') return '';
  // DOMParser does not execute scripts or fetch resources while parsing
  const doc = new DOMParser().parseFromString(html, 'text/html');
  sanitizeElement(doc.body);
  return doc.body.innerHTML;
};

export default sanitizeHtml;
