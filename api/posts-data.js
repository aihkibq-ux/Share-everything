const { queryPublicPosts } = require("../server/notion-server");
const {
  applyPublicErrorHeaders,
  getPublicContentErrorStatus,
  readPositiveInteger,
  readQueryString,
  serializePublicError,
} = require("../server/public-content");

module.exports = async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET, HEAD");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const category = readQueryString(req.query.category);
  const search = readQueryString(req.query.search);
  const page = readPositiveInteger(req.query.page, 1);

  try {
    const data = await queryPublicPosts({ category, search, page });
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json(data);
  } catch (error) {
    const status = getPublicContentErrorStatus(error);
    console.error("Failed to load public post list:", error);

    applyPublicErrorHeaders(res, error);
    res.setHeader("Cache-Control", "no-store");
    return res.status(status).json(
      serializePublicError(
        error,
        status === 500 ? "Post list unavailable" : "Post list request failed",
      ),
    );
  }
};
