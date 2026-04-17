(() => {
  const siteUtils = window.SiteUtils || {};
  const DEFAULT_OG_IMAGE_URL = new URL("favicon.png?v=2", window.location.origin).href;
  const DEFAULT_OG_IMAGE_ALT = "Share Everything";

  function ensureMetaTag(selector, attributes) {
    let meta = document.head?.querySelector(selector);
    if (!meta) {
      meta = document.createElement("meta");
      Object.entries(attributes).forEach(([key, value]) => {
        meta.setAttribute(key, value);
      });
      document.head?.appendChild(meta);
    }
    return meta;
  }

  function ensureLinkTag(selector, attributes) {
    let link = document.head?.querySelector(selector);
    if (!link) {
      link = document.createElement("link");
      Object.entries(attributes).forEach(([key, value]) => {
        link.setAttribute(key, value);
      });
      document.head?.appendChild(link);
    }
    return link;
  }

  function sanitizeMetaImageUrl(candidate) {
    if (typeof siteUtils.resolveShareImageUrl === "function") {
      return siteUtils.resolveShareImageUrl(candidate, DEFAULT_OG_IMAGE_URL) || DEFAULT_OG_IMAGE_URL;
    }

    return DEFAULT_OG_IMAGE_URL;
  }

  function updateSeoMeta({
    title,
    description,
    url = window.location.href,
    canonicalUrl = url,
    ogTitle = title,
    ogDescription = description,
    ogImage = DEFAULT_OG_IMAGE_URL,
    ogImageAlt = DEFAULT_OG_IMAGE_ALT,
    ogType,
    robots,
  } = {}) {
    const resolvedUrl = new URL(url, window.location.href);
    resolvedUrl.hash = "";
    const resolvedCanonicalUrl = new URL(canonicalUrl, window.location.href);
    resolvedCanonicalUrl.hash = "";
    const resolvedOgImage = sanitizeMetaImageUrl(ogImage);

    if (typeof title === "string" && title) {
      document.title = title;
    }

    if (typeof description === "string") {
      ensureMetaTag('meta[name="description"]', {
        name: "description",
      }).content = description;
    }

    if (typeof ogTitle === "string" && ogTitle) {
      ensureMetaTag('meta[property="og:title"]', {
        property: "og:title",
      }).content = ogTitle;
    }

    if (typeof ogDescription === "string") {
      ensureMetaTag('meta[property="og:description"]', {
        property: "og:description",
      }).content = ogDescription;
    }

    if (typeof ogType === "string" && ogType) {
      ensureMetaTag('meta[property="og:type"]', {
        property: "og:type",
      }).content = ogType;
    }

    ensureMetaTag('meta[property="og:url"]', {
      property: "og:url",
    }).content = resolvedUrl.href;
    ensureMetaTag('meta[property="og:image"]', {
      property: "og:image",
    }).content = resolvedOgImage;
    ensureMetaTag('meta[property="og:image:alt"]', {
      property: "og:image:alt",
    }).content = typeof ogImageAlt === "string" && ogImageAlt ? ogImageAlt : DEFAULT_OG_IMAGE_ALT;

    ensureLinkTag('link[rel="canonical"]', {
      rel: "canonical",
    }).href = resolvedCanonicalUrl.href;

    if (typeof robots === "string" && robots) {
      ensureMetaTag('meta[name="robots"]', {
        name: "robots",
      }).content = robots;
    } else if (robots === null) {
      document.head?.querySelector('meta[name="robots"]')?.remove();
    }
  }

  window.SeoMeta = Object.freeze({
    ensureLinkTag,
    ensureMetaTag,
    updateSeoMeta,
  });
  window.updateSeoMeta = updateSeoMeta;

  updateSeoMeta({
    title: document.title,
    description: document.querySelector('meta[name="description"]')?.content,
    ogTitle: document.querySelector('meta[property="og:title"]')?.content || document.title,
    ogDescription:
      document.querySelector('meta[property="og:description"]')?.content ||
      document.querySelector('meta[name="description"]')?.content,
    ogImage: document.querySelector('meta[property="og:image"]')?.content || DEFAULT_OG_IMAGE_URL,
    ogImageAlt:
      document.querySelector('meta[property="og:image:alt"]')?.content || DEFAULT_OG_IMAGE_ALT,
    ogType: document.querySelector('meta[property="og:type"]')?.content || "website",
    robots: document.querySelector('meta[name="robots"]')?.content ?? null,
    url: window.location.href,
    canonicalUrl: document.querySelector('link[rel="canonical"]')?.href || window.location.href,
  });
})();
