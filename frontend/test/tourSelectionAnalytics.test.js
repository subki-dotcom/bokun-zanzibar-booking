import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

test('home and tour listing links report the chosen tour only when clicked', async () => {
  const analyticsId = '\0test-selection-analytics';
  const server = await createServer({
    configFile: false, esbuild: { jsx: 'automatic' },
    server: { middlewareMode: true, watch: null },
    optimizeDeps: { noDiscovery: true }, appType: 'custom',
    plugins: [{ name: 'selection-observer', enforce: 'pre',
      resolveId(id) { if (/\/utils\/analytics(?:\.js)?$/.test(id)) return analyticsId; },
      load(id) { if (id === analyticsId) return 'export const selected = []; export const trackSelectItem = tour => selected.push(tour);'; }
    }]
  });
  try {
    const observer = await server.ssrLoadModule(analyticsId);
    const home = await server.ssrLoadModule('/src/components/homePage/HomeSections.jsx');
    const listing = await server.ssrLoadModule('/src/components/tours/toursPage/TourCard.jsx');
    const tour = { id: '42', slug: 'spice-tour', title: 'Spice Tour', meta: [], image: '' };
    const findLink = (node) => {
      if (!node || typeof node !== 'object') return null;
      if (node.props?.to === '/tours/spice-tour') return node;
      return [node.props?.children].flat().map(findLink).find(Boolean);
    };
    for (const Card of [home.TourCard, listing.default]) {
      const before = observer.selected.length;
      const link = findLink(Card({ tour }));
      assert.ok(link, 'tour details link exists');
      assert.equal(observer.selected.length, before, 'render does not count as selection');
      link.props.onClick();
      assert.equal(observer.selected.length, before + 1);
      assert.equal(observer.selected.at(-1), tour);
    }
  } finally { await server.close(); }
});
