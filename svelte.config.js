import adapter from '@sveltejs/adapter-node';

export default {
  kit: {
    adapter: adapter({ out: 'build' }),
    // Absolute asset paths (/_app/...). The SvelteKit 2 default is relative
    // (./_app/...), which makes dynamic import() resolve wrong on iOS Safari
    // ("Importing a module script failed" → hydration dies, buttons do nothing).
    // We always serve from the domain root, so absolute paths are correct.
    paths: { relative: false }
  }
};
