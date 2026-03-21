(() => {
  function initIndexPage() {
    const searchInput = document.getElementById("heroSearch");
    const searchIcon = document.querySelector(".search-icon");
    const ctaHome = document.getElementById("ctaHome");
    const ctaStart = document.getElementById("ctaStart");
    const ctaWiki = document.getElementById("ctaWiki");

    if (!searchInput || !searchIcon || !ctaHome || !ctaStart || !ctaWiki) {
      return null;
    }

    function executeSearch() {
      const query = searchInput.value.trim();
      if (query) {
        window.SPARouter?.navigate(`blog.html?search=${encodeURIComponent(query)}`);
      }
    }

    function handleSearchKeyDown(event) {
      if (event.key === "Enter") {
        executeSearch();
      }
    }

    function handleHomeClick() {
      window.SPARouter?.navigate("blog.html");
    }

    function handleStartClick() {
      window.SPARouter?.navigate("blog.html?category=精选");
    }

    function handleWikiClick() {
      window.SPARouter?.navigate("blog.html?category=收藏");
    }

    searchInput.addEventListener("keydown", handleSearchKeyDown);
    searchIcon.addEventListener("click", executeSearch);
    ctaHome.addEventListener("click", handleHomeClick);
    ctaStart.addEventListener("click", handleStartClick);
    ctaWiki.addEventListener("click", handleWikiClick);

    return () => {
      searchInput.removeEventListener("keydown", handleSearchKeyDown);
      searchIcon.removeEventListener("click", executeSearch);
      ctaHome.removeEventListener("click", handleHomeClick);
      ctaStart.removeEventListener("click", handleStartClick);
      ctaWiki.removeEventListener("click", handleWikiClick);
    };
  }

  window.PageRuntime?.register("index", {
    init: initIndexPage,
  });
})();
