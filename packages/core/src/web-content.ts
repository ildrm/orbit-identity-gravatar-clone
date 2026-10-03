import { parse, type DefaultTreeAdapterMap } from 'parse5';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { safeUrlSchema } from '../../contracts/src/index.js';
type Node = DefaultTreeAdapterMap['node'];
function walk(root: Node, visitor: (node: Node) => void) {
  const pending: Node[] = [root];
  let visited = 0;
  while (pending.length) {
    const node = pending.pop()!;
    if (++visited > 20000) throw new Error('DocumentTooComplex');
    visitor(node);
    if ('childNodes' in node) pending.push(...node.childNodes);
  }
}
export function reciprocalLink(html: string, pageUrl: string, expected: string): boolean {
  let found = false;
  const document = parse(html);
  walk(document, (node) => {
    if (!('tagName' in node) || !['a', 'link'].includes(node.tagName)) return;
    const rel =
      node.attrs
        .find((a) => a.name === 'rel')
        ?.value.toLowerCase()
        .split(/\s+/) ?? [];
    const href = node.attrs.find((a) => a.name === 'href')?.value;
    if (!rel.includes('me') || !href) return;
    try {
      const url = new URL(href, pageUrl);
      url.hash = '';
      found ||= url.href === expected;
    } catch {
      /* Invalid links do not establish ownership. */
    }
  });
  return found;
}
export function websiteProfile(html: string): Record<string, unknown>[] {
  const objects: Record<string, unknown>[] = [];
  walk(parse(html), (node) => {
    if (
      !('tagName' in node) ||
      node.tagName !== 'script' ||
      !node.attrs.some((a) => a.name === 'type' && a.value.toLowerCase() === 'application/ld+json')
    )
      return;
    const content = node.childNodes
      .filter((n) => 'value' in n)
      .map((n) => ('value' in n ? n.value : ''))
      .join('');
    try {
      const value: unknown = JSON.parse(content);
      const candidates = Array.isArray(value) ? value : [value];
      for (const v of candidates)
        if (v && typeof v === 'object' && !Array.isArray(v)) {
          const obj = v as Record<string, unknown>;
          if (['Person', 'Organization', 'ProfilePage'].includes(String(obj['@type'])))
            objects.push(obj);
        }
    } catch {
      /* Malformed structured data is excluded. */
    }
  });
  return objects.slice(0, 10);
}
export function feedItems(xml: string): { label: string; url: string; description?: string }[] {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml) || xml.length > 256000 || XMLValidator.validate(xml) !== true)
    throw new Error('InvalidFeed');
  const parser = new XMLParser({
    ignoreAttributes: false,
    processEntities: false,
    parseTagValue: false,
    trimValues: true,
  });
  const object = (value: unknown): Record<string, unknown> =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const data = object(parser.parse(xml)),
    channel = object(object(data.rss).channel),
    feed = object(data.feed);
  const raw = channel.item ?? feed.entry ?? [],
    entries = Array.isArray(raw) ? raw : [raw],
    result: { label: string; url: string; description?: string }[] = [];
  for (const rawEntry of entries.slice(0, 30)) {
    const entry = object(rawEntry);
    const links = Array.isArray(entry.link) ? entry.link : [entry.link];
    const link = links.find(
      (v: unknown) =>
        typeof v === 'string' ||
        (v && typeof v === 'object' && (object(v)['@_rel'] ?? 'alternate') === 'alternate'),
    );
    const url = typeof link === 'string' ? link : object(link)['@_href'];
    const label = typeof entry.title === 'string' ? entry.title : object(entry.title)['#text'];
    if (
      typeof label !== 'string' ||
      typeof url !== 'string' ||
      !safeUrlSchema.safeParse(url).success
    )
      continue;
    result.push({ label: label.slice(0, 160), url });
  }
  return result;
}
