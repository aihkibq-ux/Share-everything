/**
 * Legacy Notion proxy endpoint.
 *
 * The app now serves blog content through semantic, first-party endpoints:
 *   - /api/posts-data
 *   - /api/post-data
 *
 * Keeping a public pass-through proxy makes it too easy to widen the public
 * surface area accidentally, so this endpoint is intentionally disabled.
 */

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  return res.status(410).json({
    error: "The generic Notion proxy is disabled. Use /api/posts-data or /api/post-data instead.",
  });
};
