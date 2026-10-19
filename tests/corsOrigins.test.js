const {
  parseOriginList,
  getAllowedOrigins,
  buildCorsOptions,
  buildSocketCorsOptions,
  DEFAULT_PRODUCTION_ORIGINS,
  DEFAULT_DEV_ORIGINS,
} = require('../utils/corsOrigins');

describe('CORS origin allowlist', () => {
  test('includes the production frontend and local dev origins by default', () => {
    const origins = getAllowedOrigins({});
    expect(origins).toEqual(expect.arrayContaining(DEFAULT_PRODUCTION_ORIGINS));
    expect(origins).toEqual(expect.arrayContaining(DEFAULT_DEV_ORIGINS));
  });

  test('parseOriginList splits, trims, and drops empty entries', () => {
    expect(parseOriginList(' https://a.example , https://b.example ,, ')).toEqual([
      'https://a.example',
      'https://b.example',
    ]);
    expect(parseOriginList(undefined)).toEqual([]);
  });

  test('adds configured CLIENT_URL and CLIENT_URLS entries without duplicates', () => {
    const origins = getAllowedOrigins({
      CLIENT_URL: 'https://rubavuconnect.vercel.app',
      CLIENT_URLS: 'https://extra.example, http://localhost:5173',
    });
    expect(origins).toContain('https://extra.example');
    expect(origins.filter((o) => o === 'https://rubavuconnect.vercel.app')).toHaveLength(1);
    expect(origins.filter((o) => o === 'http://localhost:5173')).toHaveLength(1);
  });

  test('buildCorsOptions allows known origins and requests without an Origin', (done) => {
    const options = buildCorsOptions({});

    options.origin(undefined, (err, allowed) => {
      expect(err).toBeNull();
      expect(allowed).toBe(true);
    });

    options.origin('https://rubavuconnect.vercel.app', (err, allowed) => {
      expect(err).toBeNull();
      expect(allowed).toBe(true);
    });

    options.origin('https://evil.example', (err, allowed) => {
      expect(err).toBeNull();
      expect(allowed).toBe(false);
      done();
    });
  });

  test('buildSocketCorsOptions exposes the same allowlist for socket.io', () => {
    const options = buildSocketCorsOptions({});
    expect(Array.isArray(options.origin)).toBe(true);
    expect(options.origin).toEqual(expect.arrayContaining(DEFAULT_PRODUCTION_ORIGINS));
    expect(options.credentials).toBe(true);
  });
});
