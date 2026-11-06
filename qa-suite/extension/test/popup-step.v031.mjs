// Drop-in replacement for the TWO stale popup steps in ext3/test/e2e.mjs ('popup lists the recent save...' and 'popup saves the current page...').
// They target the v0.2 popup (recent-saves list, "Synced" badge, #tag chips); v0.3.x replaced it with Save-current-page + a feed.
// Paste it where those two steps were (between the Overlay and Context menu sections). Verified: 30/30 steps pass on ext3 v0.3.1.
await step('v0.3.1 popup: "Save current page" saves with note + tag via the Note, tags... panel and Ctrl+Enter', async () => {
  const n = saved.length;
  await popup.getByRole('button', { name: 'Note, tags…' }).click();
  await popup.getByLabel('Note').fill('from the popup');
  await popup.getByLabel('Tags').fill('vector-search'); await popup.keyboard.press('Enter');
  await popup.getByRole('button', { name: /Remove tag vector-search/ }).waitFor();
  await popup.getByLabel('Note').press('Control+Enter');
  await popup.getByRole('button', { name: /Saved!/ }).waitFor({ timeout: 4000 });
  assert.equal(saved.length, n + 1); assert.deepEqual(saved[n].tags, ['vector-search']); assert.equal(saved[n].note, 'from the popup');
  await popup.screenshot({ path: join(shots, 'popup-saved.png') });
});

