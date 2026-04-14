export const notionBlockFixtures = Object.freeze([
  Object.freeze({
    name: "image figure with figcaption",
    rawBlocks: Object.freeze([
      Object.freeze({
        id: "hero-image",
        type: "image",
        image: Object.freeze({
          external: Object.freeze({ url: "https://example.com/assets/diagram.png" }),
          caption: Object.freeze([
            Object.freeze({
              plain_text: "Architecture diagram",
              annotations: Object.freeze({ bold: true }),
            }),
          ]),
        }),
      }),
    ]),
    expectedTypes: Object.freeze(["image"]),
    mappedChecks: Object.freeze([
      Object.freeze({ blockIndex: 0, path: "caption", equals: "Architecture diagram" }),
      Object.freeze({ blockIndex: 0, path: "captionHtml", includes: "<strong>Architecture diagram</strong>" }),
    ]),
    expectedHtmlIncludes: Object.freeze([
      '<figure class="post-figure post-figure-image">',
      '<img class="post-figure-media" src="https://example.com/assets/diagram.png"',
      '<figcaption class="post-figure-caption"><strong>Architecture diagram</strong></figcaption>',
    ]),
  }),
  Object.freeze({
    name: "resource figure with semantic caption",
    rawBlocks: Object.freeze([
      Object.freeze({
        id: "spec-pdf",
        type: "pdf",
        pdf: Object.freeze({
          external: Object.freeze({ url: "https://example.com/specification.pdf" }),
          caption: Object.freeze([
            Object.freeze({ plain_text: "Detailed specification" }),
          ]),
        }),
      }),
    ]),
    expectedTypes: Object.freeze(["resource"]),
    mappedChecks: Object.freeze([
      Object.freeze({ blockIndex: 0, path: "resourceType", equals: "pdf" }),
      Object.freeze({ blockIndex: 0, path: "captionHtml", includes: "Detailed specification" }),
    ]),
    expectedHtmlIncludes: Object.freeze([
      '<figure class="post-resource post-resource-pdf">',
      '<p class="post-block-label">PDF</p>',
      'href="https://example.com/specification.pdf"',
      '<figcaption class="post-resource-caption">Detailed specification</figcaption>',
    ]),
  }),
  Object.freeze({
    name: "bookmark cards expose hostname and URL",
    rawBlocks: Object.freeze([
      Object.freeze({
        id: "docs-bookmark",
        type: "bookmark",
        bookmark: Object.freeze({
          url: "https://www.docs.example.com/guide?ref=nav",
        }),
      }),
    ]),
    expectedTypes: Object.freeze(["bookmark"]),
    expectedHtmlIncludes: Object.freeze([
      '<article class="post-bookmark">',
      '<p class="post-block-label">Bookmark</p>',
      '<span class="post-bookmark-title">docs.example.com</span>',
      '<span class="post-bookmark-url">https://www.docs.example.com/guide?ref=nav</span>',
    ]),
  }),
  Object.freeze({
    name: "equations render as math figures",
    rawBlocks: Object.freeze([
      Object.freeze({
        id: "equation-energy",
        type: "equation",
        equation: Object.freeze({
          expression: "E = mc^2",
        }),
      }),
    ]),
    expectedTypes: Object.freeze(["equation"]),
    expectedHtmlIncludes: Object.freeze([
      '<figure class="post-equation">',
      '<figcaption class="post-block-label">Equation</figcaption>',
      'role="math"',
      "<code>E = mc^2</code>",
    ]),
  }),
  Object.freeze({
    name: "child databases render as labeled sections",
    rawBlocks: Object.freeze([
      Object.freeze({
        id: "api-schema",
        type: "child_database",
        child_database: Object.freeze({
          title: "API Schema",
        }),
      }),
    ]),
    expectedTypes: Object.freeze(["child_database"]),
    expectedHtmlIncludes: Object.freeze([
      '<section class="post-child-page" aria-label="Child database">',
      '<p class="post-block-label">Child database</p>',
      '<p class="post-child-page-title">API Schema</p>',
    ]),
  }),
  Object.freeze({
    name: "table of contents links to heading anchors",
    rawBlocks: Object.freeze([
      Object.freeze({
        id: "overview",
        type: "heading_1",
        heading_1: Object.freeze({
          rich_text: Object.freeze([
            Object.freeze({ plain_text: "Overview" }),
          ]),
        }),
      }),
      Object.freeze({
        id: "toc-block",
        type: "table_of_contents",
        table_of_contents: Object.freeze({}),
      }),
      Object.freeze({
        id: "details",
        type: "heading_2",
        heading_2: Object.freeze({
          rich_text: Object.freeze([
            Object.freeze({ plain_text: "Details" }),
          ]),
        }),
      }),
    ]),
    expectedTypes: Object.freeze(["heading_1", "table_of_contents", "heading_2"]),
    mappedChecks: Object.freeze([
      Object.freeze({ blockIndex: 0, path: "anchorId", equals: "heading-overview" }),
      Object.freeze({ blockIndex: 2, path: "anchorId", equals: "heading-details" }),
    ]),
    expectedHtmlIncludes: Object.freeze([
      '<h1 id="heading-overview">Overview</h1>',
      '<nav class="post-table-of-contents" aria-label="Table of contents">',
      'href="#heading-overview">Overview</a>',
      'class="post-table-of-contents-item level-2"><a href="#heading-details">Details</a>',
      '<h2 id="heading-details">Details</h2>',
    ]),
    expectedHtmlExcludes: Object.freeze([
      "Unsupported block:",
    ]),
  }),
  Object.freeze({
    name: "column containers preserve child paragraphs",
    rawBlocks: Object.freeze([
      Object.freeze({
        id: "column-layout",
        type: "column_list",
        children: Object.freeze([
          Object.freeze({
            id: "left-column",
            type: "column",
            children: Object.freeze([
              Object.freeze({
                id: "left-text",
                type: "paragraph",
                paragraph: Object.freeze({
                  rich_text: Object.freeze([
                    Object.freeze({ plain_text: "Left column" }),
                  ]),
                }),
              }),
            ]),
          }),
          Object.freeze({
            id: "right-column",
            type: "column",
            children: Object.freeze([
              Object.freeze({
                id: "right-text",
                type: "paragraph",
                paragraph: Object.freeze({
                  rich_text: Object.freeze([
                    Object.freeze({ plain_text: "Right column" }),
                  ]),
                }),
              }),
            ]),
          }),
        ]),
      }),
    ]),
    expectedTypes: Object.freeze(["container"]),
    expectedHtmlIncludes: Object.freeze([
      "<p>Left column</p>",
      "<p>Right column</p>",
    ]),
    expectedHtmlExcludes: Object.freeze([
      "Unsupported block: column",
      "Unsupported block: column list",
    ]),
  }),
  Object.freeze({
    name: "tables retain semantic captions and scopes",
    rawBlocks: Object.freeze([
      Object.freeze({
        id: "team-table",
        type: "table",
        table: Object.freeze({
          has_column_header: true,
          has_row_header: true,
        }),
        children: Object.freeze([
          Object.freeze({
            id: "header-row",
            type: "table_row",
            table_row: Object.freeze({
              cells: Object.freeze([
                Object.freeze([Object.freeze({ plain_text: "Name" })]),
                Object.freeze([Object.freeze({ plain_text: "Value" })]),
              ]),
            }),
          }),
          Object.freeze({
            id: "body-row",
            type: "table_row",
            table_row: Object.freeze({
              cells: Object.freeze([
                Object.freeze([Object.freeze({ plain_text: "Lang" })]),
                Object.freeze([Object.freeze({ plain_text: "TypeScript" })]),
              ]),
            }),
          }),
        ]),
      }),
    ]),
    expectedTypes: Object.freeze(["table"]),
    mappedChecks: Object.freeze([
      Object.freeze({ blockIndex: 0, path: "hasColumnHeader", equals: true }),
      Object.freeze({ blockIndex: 0, path: "hasRowHeader", equals: true }),
      Object.freeze({ blockIndex: 0, path: "children.0.type", equals: "table_row" }),
    ]),
    expectedHtmlIncludes: Object.freeze([
      'class="post-table-wrapper" role="region" aria-label="Content table" tabindex="0"',
      '<caption class="visually-hidden">Content table</caption>',
      '<th scope="col">Name</th>',
      '<th scope="row">Lang</th>',
    ]),
  }),
  Object.freeze({
    name: "unsupported blocks stay visible with diagnostics",
    rawBlocks: Object.freeze([
      Object.freeze({
        id: "mystery-widget",
        type: "mystery_widget",
        mystery_widget: Object.freeze({
          url: "https://example.com/widget",
          rich_text: Object.freeze([
            Object.freeze({ plain_text: "Needs a fallback" }),
          ]),
        }),
      }),
    ]),
    expectedTypes: Object.freeze(["unsupported"]),
    expectedHtmlIncludes: Object.freeze([
      '<aside class="post-unsupported" aria-label="Unsupported Notion block">',
      "Unsupported block: mystery widget",
      '<div class="post-unsupported-detail">Needs a fallback</div>',
      'href="https://example.com/widget"',
    ]),
  }),
]);
