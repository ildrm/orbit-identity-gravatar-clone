import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { IdentityAvatar, IdentityLink } from '../../packages/ui/src/index';
describe('Rendered integration components', () => {
  it('encodes identifiers and escapes content in actual HTML', () => {
    const avatar = renderToStaticMarkup(
      createElement(IdentityAvatar, {
        origin: 'https://identity.example/path',
        identityId: 'a/../?x=1',
        alt: '<script>alert(1)</script>',
        size: 128,
      }),
    );
    expect(avatar).toContain('https://identity.example/avatar/a%2F..%2F%3Fx%3D1?size=128');
    expect(avatar).toContain('alt="&lt;script&gt;alert(1)&lt;/script&gt;"');
    const link = renderToStaticMarkup(
      createElement(IdentityLink, {
        origin: 'https://identity.example',
        handle: 'x?redirect=evil',
        children: '<script>',
      }),
    );
    expect(link).toContain('/u/x%3Fredirect%3Devil');
    expect(link).toContain('&lt;script&gt;');
  });
  it('rejects insecure remote, credential-bearing and executable origins', () => {
    for (const origin of [
      'http://remote.example',
      'https://user:secret@identity.example',
      'javascript:alert(1)',
      'data:text/html,test',
    ]) {
      expect(() =>
        renderToStaticMarkup(
          createElement(IdentityAvatar, { origin, identityId: 'idn_example', alt: 'Avatar' }),
        ),
      ).toThrow();
      expect(() =>
        renderToStaticMarkup(
          createElement(IdentityLink, { origin, handle: 'example', children: 'Example' }),
        ),
      ).toThrow();
    }
  });
  it('permits loopback development and rejects unbounded avatar dimensions', () => {
    expect(
      renderToStaticMarkup(
        createElement(IdentityAvatar, {
          origin: 'http://localhost:8080',
          identityId: 'test',
          alt: 'Avatar',
        }),
      ),
    ).toContain('http://localhost:8080/avatar/test?size=64');
    for (const size of [0, 15, 1025, Number.NaN, 24.5])
      expect(() =>
        renderToStaticMarkup(
          createElement(IdentityAvatar, {
            origin: 'https://identity.example',
            identityId: 'test',
            alt: 'Avatar',
            size,
          }),
        ),
      ).toThrow();
  });
});
