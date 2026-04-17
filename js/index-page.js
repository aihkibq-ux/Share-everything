(() => {
  function initIndexPage() {
    const sharedContent = window.NotionContent || {};
    const siteUtils = window.SiteUtils || {};
    const featuredCategory =
      typeof sharedContent.getRemoteBlogCategories === "function"
        ? sharedContent.getRemoteBlogCategories().find((category) => category.name !== (sharedContent.ALL_CATEGORY || "全部"))?.name || "精选"
        : "精选";
    const searchForm = document.getElementById("heroSearchForm");
    const searchInput = document.getElementById("heroSearch");
    const ctaHome = document.getElementById("ctaHome");
    const ctaStart = document.getElementById("ctaStart");
    const ctaWiki = document.getElementById("ctaWiki");

    if (!searchForm || !searchInput || !ctaHome || !ctaStart || !ctaWiki) {
      return null;
    }

    function navigateTo(url) {
      if (window.SPARouter?.navigate) {
        window.SPARouter.navigate(url);
      } else {
        window.location.href = url;
      }
    }

    function executeSearch() {
      const query = searchInput.value.trim();
      if (query) {
        navigateTo(`/blog.html?search=${encodeURIComponent(query)}`);
      }
    }

    function handleSearchSubmit(event) {
      event.preventDefault();
      executeSearch();
    }

    function handleLinkClick(event) {
      event.preventDefault();
      const href = event.currentTarget?.getAttribute("href");
      if (href) {
        navigateTo(href);
      }
    }

    ctaHome.href = "/blog.html";
    ctaStart.href = `/blog.html?category=${encodeURIComponent(featuredCategory)}`;
    ctaWiki.href =
      typeof siteUtils.buildBookmarkListingUrl === "function"
        ? siteUtils.buildBookmarkListingUrl()
        : "/blog.html#bookmarks";

    searchForm.addEventListener("submit", handleSearchSubmit);
    ctaHome.addEventListener("click", handleLinkClick);
    ctaStart.addEventListener("click", handleLinkClick);
    ctaWiki.addEventListener("click", handleLinkClick);

    return () => {
      searchForm.removeEventListener("submit", handleSearchSubmit);
      ctaHome.removeEventListener("click", handleLinkClick);
      ctaStart.removeEventListener("click", handleLinkClick);
      ctaWiki.removeEventListener("click", handleLinkClick);
    };
  }

  window.PageRuntime?.register("index", {
    init: initIndexPage,
  });
})();
