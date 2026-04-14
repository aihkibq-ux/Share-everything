const { fetchPublicPost } = require("../server/notion-server");
const {
  applyPublicErrorHeaders,
  getPublicPostErrorStatus,
  readQueryString,
  serializePublicError,
} = require("../server/public-content");

module.exports = async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET, HEAD");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const routeId = readQueryString(req.query.id);

  if (!routeId) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(404).json({ error: "Post not found" });
  }

  try {
    const post = await fetchPublicPost(routeId);
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json(post);
  } catch (error) {
    const status = getPublicPostErrorStatus(error);
    if (status !== 404) {
      console.error("Failed to load post data:", error);
    }

    applyPublicErrorHeaders(res, error);
    res.setHeader("Cache-Control", "no-store");
    return res.status(status).json(
      serializePublicError(
        error,
        status === 404 ? "Post not found" : "Post unavailable",
      ),
    );
  }
};
