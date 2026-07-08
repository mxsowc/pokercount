import adapter from '@sveltejs/adapter-node';

export default {
  kit: {
    // precompress: ship gzip + brotli copies of client assets so the Node server
    // serves them pre-compressed (smaller transfers, no per-request CPU to gzip).
    adapter: adapter({ out: 'build', precompress: true }),
    // Absolute asset paths (/_app/...). The SvelteKit 2 default is relative
    // (./_app/...), which makes dynamic import() resolve wrong on iOS Safari
    // ("Importing a module script failed" → hydration dies, buttons do nothing).
    // We always serve from the domain root, so absolute paths are correct.
    paths: { relative: false }
  }
};
