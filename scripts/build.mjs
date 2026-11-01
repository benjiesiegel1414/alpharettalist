// AlpharettaList.com static site generator. No dependencies.
// Usage: node scripts/build.mjs
// Optional env: SHEET_BUSINESSES_CSV, SHEET_EVENTS_CSV (published Google Sheet CSV URLs; only rows with Approved = yes are published)
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const SRC = path.join(ROOT, "src");
const OUT = path.join(ROOT, "docs");
// Config check relaxed: GA4 and form endpoint are optional until they are set up for this site.
const SITE = "https://alpharettalist.com";
const BUILD_DATE = new Date().toISOString().slice(0, 10);
// Cache-busting version for CSS/JS: changes whenever their source changes.
const ASSET_V = (() => { const h = (str) => { let x = 5381; for (let i = 0; i < str.length; i++) x = ((x * 33) ^ str.charCodeAt(i)) >>> 0; return x.toString(36); };
  return h(["assets/base.css", "assets/extra.css", "assets/main.js", "assets/config.js"].map(f => fs.readFileSync(path.join(SRC, f), "utf8")).join("")); })();

const read = (p) => fs.readFileSync(path.join(SRC, p), "utf8");
const json = (p) => JSON.parse(read(p));
const esc = (s = "") => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const slugify = (s) => String(s).toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const write = (rel, html) => {
  const file = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, html);
  return rel;
};

// ---------- Data ----------
let places = json("data/places.json");
let events = json("data/events.json");
// Newest first: sort by published date, and for posts published the same day, the one added to posts.json last comes first.
const posts = json("data/posts.json").map((p, i) => [p, i]).sort((x, y) => (y[0].published || "").localeCompare(x[0].published || "") || y[1] - x[1]).map(x => x[0]);
// Internal linking: which places each post links to, and which posts mention each place.
const postPlaceLinks = {};
const postsByPlace = {};
for (const p of posts) {
  let html = "";
  try { html = fs.readFileSync(path.join(SRC, "content/blog", p.slug + ".html"), "utf8"); } catch (e) {}
  const slugs = [...new Set([...html.matchAll(/href="\/places\/([^"\/]+)\/"/g)].map(m => m[1]))];
  postPlaceLinks[p.slug] = slugs;
  for (const sl of slugs) (postsByPlace[sl] = postsByPlace[sl] || []).push(p);
}
function relatedPosts(p, n = 6) {
  const mine = new Set(postPlaceLinks[p.slug] || []);
  return posts.filter(x => x.slug !== p.slug).map((x, i) => {
    const shared = (postPlaceLinks[x.slug] || []).filter(sl => mine.has(sl)).length;
    return [x, shared * 3 + (x.category === p.category ? 4 : 0) + Math.max(0, 3 - i / 5)];
  }).sort((a, b) => b[1] - a[1]).slice(0, n).map(x => x[0]);
}

function parseCSV(text) {
  const rows = []; let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (c !== "\r") cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [head, ...body] = rows;
  return body.filter(r => r.some(Boolean)).map(r => Object.fromEntries(head.map((h, i) => [h.trim().toLowerCase(), (r[i] || "").trim()])));
}
async function sheet(url) {
  if (!url) return [];
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(res.status);
    return parseCSV(await res.text()).filter(r => /^(y|yes|true|1)$/i.test(r.approved || ""));
  } catch (e) { console.warn("Sheet fetch failed:", url, e.message); return []; }
}
const CAT_MAP = { "pets and vets": "pets", pets: "pets", restaurant: "restaurants", restaurants: "restaurants", "home services": "home", health: "health", "health and medical": "health", "real estate": "realestate", shopping: "shopping", "kids and classes": "kids", "kids and schools": "kids", "fitness": "fitness", "things to do": "things-to-do", "parks and trails": "parks", "professional services": "services", "beauty and wellness": "beauty", schools: "schools", school: "schools" };
const sheetBiz = await sheet(process.env.SHEET_BUSINESSES_CSV);
for (const r of sheetBiz) {
  const name = r.business_name || r.name; if (!name) continue;
  const slug = slugify(name);
  if (places.some(p => p.slug === slug)) continue;
  places.push({ slug, name, cat: CAT_MAP[(r.category || "").toLowerCase()] || "services", type: r.subcategory || r.category || "Local business", schema: "LocalBusiness",
    address: r.address || "", area: r.area || "Alpharetta", desc: r.description || "", website: r.website || "", phone: r.phone || "", featured: /yes/i.test(r.featured || ""), sponsored: /yes/i.test(r.sponsored || ""), verified: true });
}
const sheetEvents = await sheet(process.env.SHEET_EVENTS_CSV);
for (const r of sheetEvents) {
  if (!r.event_name || !r.start_date) continue;
  events.push({ slug: slugify(r.event_name + "-" + r.start_date), title: r.event_name, start: r.start_date, end: r.end_date || r.start_date, venue: r.venue || "", address: r.address || "", desc: r.description || "", url: r.link || "" });
}
const todayISO = BUILD_DATE;
events = events.filter(e => (e.end || e.start) >= todayISO).sort((a, b) => a.start.localeCompare(b.start));

const CATS = [
  { id: "restaurants", label: "Restaurants", blurb: "Dining, cafes, takeout" },
  { id: "things-to-do", label: "Things to do", blurb: "Entertainment, family fun" },
  { id: "parks", label: "Parks and trails", blurb: "Greenway, Wills Park, trails" },
  { id: "arts", label: "Arts and history", blurb: "Museums, music, culture" },
  { id: "shopping", label: "Shopping", blurb: "Avalon, downtown, boutiques" },
  { id: "nearby", label: "Nearby day trips", blurb: "Within a short drive" },
  { id: "home", label: "Home services", blurb: "HVAC, plumbing, lawn" },
  { id: "health", label: "Health and medical", blurb: "Doctors, dentists, urgent care" },
  { id: "realestate", label: "Real estate", blurb: "Agents, teams, brokerages" },
  { id: "pets", label: "Pets and vets", blurb: "Veterinarians and pet care" },
  { id: "fitness", label: "Fitness and gyms", blurb: "Gyms, Pilates, yoga, studios" },
  { id: "beauty", label: "Beauty and spas", blurb: "Salons, nails, med spas" },
  { id: "kids", label: "Kids and classes", blurb: "Gymnastics, music, martial arts" },
  { id: "schools", label: "Schools", blurb: "Public, private and preschool" },
  { id: "services", label: "Local services", blurb: "Everything else" }
];
const catLabel = (id) => (CATS.find(c => c.id === id) || { label: "Local" }).label;
const fmtDate = (iso) => new Date(iso + "T12:00:00").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
const fmtShort = (iso) => new Date(iso + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
const dateChip = (e, yr) => { const d = new Date(e.start + "T12:00:00"); const mon = d.toLocaleDateString("en-US", { month: "short" }); return e.dateNote ? `<b style="font-size:17px">${mon}</b><small>TBA</small>` : `<b>${d.getDate()}</b><small>${mon}${yr ? " " + d.getFullYear() : ""}</small>`; };
const mapsLink = (p) => "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(p.name + " " + (p.address || "Alpharetta, GA"));

// ---------- Shared chrome ----------
const logoSymbol = read("assets/logo-symbol.svg");
const sprite = `<svg width="0" height="0" style="position:absolute" aria-hidden="true">${logoSymbol}</svg>`;
const logo = (light) => `<a class="brand" href="/" aria-label="Alpharetta List home"><span class="logo-tile${light ? " logo-tile-light" : ""}"><svg width="36" height="36" viewBox="0 0 64 64"><use href="#logo"/></svg></span><span class="brand-name">Alpharetta List<span>Alpharetta, Georgia</span></span></a>`;

const NAV = [["/blog/", "News"], ["/directory/", "Directory"], ["/restaurants/", "Eat and Drink"], ["/services/", "Services"], ["/things-to-do/", "Things to Do"], ["/events/", "Events"]];

// ---------- Sponsors: not used on AlpharettaList (no ad slots on this site) ----------
const sponsorBar = "", sponsorRails = "", sponsorShowcase = "";
const sponsor = () => "";
const newsletter = ""; // email signup removed for now

const footer = `
<footer>
  <div class="wrap">
    <div class="foot">
      <div class="foot-brand">${logo(true)}<p>An independent local guide to Alpharetta, Georgia, serving 30004, 30005, 30009 and 30022.</p></div>
      <div><h2 class="foot-h">Read</h2><ul><li><a href="/blog/">News and guides</a></li><li><a href="/events/">Events</a></li><li><a href="/things-to-do/">Things to do</a></li><li><a href="/directory/?cat=parks">Parks and trails</a></li></ul></div>
      <div><h2 class="foot-h">Find</h2><ul><li><a href="/restaurants/">Restaurants</a></li><li><a href="/directory/?cat=shopping">Shopping</a></li><li><a href="/services/">Local services</a></li><li><a href="/directory/">Full directory</a></li></ul></div>
      <div><h2 class="foot-h">Popular guides</h2><ul><li><a href="/blog/best-restaurants-alpharetta-ga/">Best restaurants</a></li><li><a href="/blog/things-to-do-alpharetta-ga/">Things to do</a></li><li><a href="/blog/moving-to-alpharetta-ga-guide/">Moving to Alpharetta</a></li><li><a href="/blog/best-coffee-shops-alpharetta-ga/">Coffee shops</a></li></ul></div>
      <div><h2 class="foot-h">Work with us</h2><ul><li><a href="/add-your-business/">Add your business</a></li><li><a href="/submit-event/">Submit an event</a></li><li><a href="/about/">About</a></li></ul></div>
    </div>
    <div class="legal"><span>&copy; <span id="yr">${new Date().getFullYear()}</span> Alpharetta List. Independent and not affiliated with the City of Alpharetta.</span><span><a href="mailto:hello@alpharettalist.com">hello@alpharettalist.com</a> &nbsp; <a href="/privacy/">Privacy</a> &nbsp; <a href="/about/">About</a></span></div>
  </div>
</footer>`;

function layout({ title, description, urlPath, body, jsonld = [], ogType = "website", noindex = false, article = null, image = "", sponsors = true, bodyClass = "", ads = false }) {
  const ogImg = image ? SITE + image : SITE + "/assets/og.jpg";
  const canonical = SITE + urlPath;
  const org = { "@context": "https://schema.org", "@type": "Organization", "@id": SITE + "/#org", name: "Alpharetta List", url: SITE + "/", logo: SITE + "/assets/icon-512.png", areaServed: { "@type": "City", name: "Alpharetta, Georgia" } };
  const ld = [org, ...jsonld].map(o => `<script type="application/ld+json">${JSON.stringify(o)}</script>`).join("\n");
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${canonical}">
${noindex ? '<meta name="robots" content="noindex">' : '<meta name="robots" content="index, follow, max-image-preview:large">'}
<meta property="og:site_name" content="Alpharetta List">
<meta property="og:type" content="${ogType}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${canonical}">
<meta property="og:image" content="${ogImg}">
<meta property="og:locale" content="en_US">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${ogImg}">
${article ? `<meta property="article:published_time" content="${article.published}">\n<meta property="article:modified_time" content="${article.updated}">` : ""}
<meta name="theme-color" content="#211E1B">
<meta name="geo.region" content="US-GA">
<meta name="geo.placename" content="Alpharetta">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/favicon-32.png" sizes="32x32" type="image/png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="alternate" type="application/rss+xml" title="Alpharetta List" href="/feed.xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Newsreader:opsz,wght@6..72,400;6..72,500;6..72,600&family=Public+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/assets/site.css?v=${ASSET_V}">
${ld}
</head>
<body${bodyClass ? ` class="${bodyClass}"` : ""}>
${sprite}
<a class="sr" href="#main">Skip to content</a>
<header class="site"><div class="wrap">
  ${logo(false)}
  <nav class="main" id="mainnav" aria-label="Main">${NAV.map(([h, l]) => `<a href="${h}"${urlPath.startsWith(h) ? ' aria-current="page"' : ""}>${l}</a>`).join("")}</nav>
  <a class="btn btn-primary header-cta" href="/add-your-business/">Add your business</a>
  <button class="menu-toggle" aria-expanded="false" aria-controls="mainnav">Menu</button>
</div></header>
${sponsors ? sponsorBar + "\n" + sponsorRails : ""}
<main id="main">
${body}
</main>
${sponsors ? sponsorShowcase : ""}
${footer}
<script src="/assets/config.js?v=${ASSET_V}"></script>
<script src="/assets/main.js?v=${ASSET_V}" defer></script>
</body>
</html>`;
}

const crumbsHTML = (items) => `<nav class="crumbs" aria-label="Breadcrumb">${items.map((it, i) => (i < items.length - 1 ? `<a href="${it[1]}">${esc(it[0])}</a><span aria-hidden="true">/</span>` : `<span aria-current="page">${esc(it[0])}</span>`)).join("")}</nav>`;
const crumbsLD = (items) => ({ "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: items.map((it, i) => ({ "@type": "ListItem", position: i + 1, name: it[0], item: SITE + it[1] })) });
const pageHead = (crumbs, h1, sub, extra = "") => `
<section class="page-head"><svg class="hero-mark" viewBox="0 0 64 64" aria-hidden="true"><use href="#logo"/></svg>
  <div class="wrap">${crumbsHTML(crumbs)}<h1>${h1}</h1>${sub ? `<p>${sub}</p>` : ""}${extra}</div>
</section>`;

const listingCard = (p) => `
<article class="listing${p.sponsored ? " sponsored" : ""}" data-cat="${p.cat}" data-search="${esc((p.name + " " + p.type + " " + (p.cuisine || "") + " " + p.desc + " " + (p.area || "") + " " + catLabel(p.cat)).toLowerCase())}">
  <div class="listing-top"><span>${esc(p.type)}</span>${p.sponsored ? '<span class="pill spons">Sponsored</span>' : p.verified ? '<span class="pill ver">Verified</span>' : ""}</div>
  <h3 class="h4"><a href="/places/${p.slug}/">${esc(p.name)}</a></h3>
  <p>${esc(p.desc)}</p>
  <div class="meta"><span>${esc(p.area || "Alpharetta")}</span><a href="/places/${p.slug}/">Details</a></div>
</article>`;

const postCard = (p) => `
<article class="post-card">
  <a class="thumb" href="/blog/${p.slug}/" aria-label="${esc(p.h1)}">${coverImg(p) || '<svg viewBox="0 0 64 64" aria-hidden="true"><use href="#logo"/></svg>'}</a>
  <div class="pad"><div class="tag">${esc(p.category)}</div><h3><a href="/blog/${p.slug}/">${esc(p.h1)}</a></h3><p>${esc(p.description)}</p><div class="byline">${fmtDate(p.published)} &middot; ${p.readMins} min read</div></div>
</article>`;

const coverFile = (p) => fs.existsSync(path.join(SRC, "covers", p.slug + ".jpg")) ? `/assets/covers/${p.slug}.jpg` : "";
const coverImg = (p, eager) => coverFile(p) ? `<img src="${coverFile(p)}" alt="${esc(p.coverAlt || p.h1)}" ${eager ? 'fetchpriority="high"' : 'loading="lazy"'} width="1600" height="900">` : "";
const pages = []; // for sitemap: [path, lastmod, priority]
const add = (urlPath, html, priority = "0.7", lastmod = BUILD_DATE) => { write(urlPath === "/" ? "index.html" : urlPath.replace(/^\//, "") + "index.html", html); pages.push([urlPath, lastmod, priority]); };

// ---------- Home ----------
{
  const featured = places.filter(p => p.featured).slice(0, 9);
  const counts = Object.fromEntries(CATS.map(c => [c.id, places.filter(p => p.cat === c.id).length]));
  const lead = posts[0], rest = posts.slice(1, 10);
  const body = `
<section class="hero"><svg class="hero-mark" viewBox="0 0 64 64" aria-hidden="true"><use href="#logo"/></svg>
  <div class="wrap">
    <h1>Everything happening in Alpharetta, in one place.</h1>
    <p class="lede">Restaurants, things to do, trusted local businesses, events and news, all across Alpharetta, Georgia.</p>
    <form class="search" role="search" action="/directory/" method="get">
      <label><span class="sr">Search</span><input name="q" type="search" placeholder="Search restaurants, parks, coffee, sushi..."></label>
      <select name="cat" aria-label="Category"><option value="all">All categories</option>${CATS.filter(c => counts[c.id]).map(c => `<option value="${c.id}">${c.label}</option>`).join("")}</select>
      <button class="btn btn-primary" type="submit">Search Alpharetta</button>
    </form>
    <div class="quick"><span>Popular:</span><a href="/restaurants/">Restaurants</a><a href="/things-to-do/">Things to do</a><a href="/places/avalon/">Avalon</a><a href="/places/big-creek-greenway/">Big Creek Greenway</a><a href="/events/">Events</a></div>
  </div>
</section>
<div class="wrap">${sponsor()}</div>

<section class="block" id="news"><div class="wrap">
  <div class="sec-head"><h2>Alpharetta news</h2><a href="/blog/">All news</a></div>
  <div class="news-grid"><div class="news-main">
    <article class="lead-story">
      <a class="img" href="/blog/${lead.slug}/" style="display:grid;place-items:center" aria-label="${esc(lead.h1)}">${coverImg(lead, true) || '<svg viewBox="0 0 64 64" width="34%" style="color:#fff" aria-hidden="true"><use href="#logo"/></svg>'}</a>
      <div class="tag">${esc(lead.category)}</div>
      <h3><a href="/blog/${lead.slug}/">${esc(lead.h1)}</a></h3>
      <p>${esc(lead.description)}</p><div class="byline">${fmtDate(lead.published)} &middot; ${lead.readMins} min read</div>
    </article>
    <ul class="story-list">
      ${rest.map(p => `<li><div class="tag">${esc(p.category)}</div><h4><a href="/blog/${p.slug}/">${esc(p.h1)}</a></h4><div class="byline">${fmtDate(p.published)}</div></li>`).join("")}
      <li><div class="tag">Guide</div><h4><a href="/things-to-do/">The best things to do in Alpharetta, GA</a></h4><div class="byline">Guide</div></li>
      <li><div class="tag">Eat and Drink</div><h4><a href="/restaurants/">Alpharetta's most popular restaurants</a></h4><div class="byline">Guide</div></li>
    </ul>
  </div>
  <aside class="rail" id="events"><div><h3>Coming up</h3>
    <ul class="events">${events.slice(0, 4).map(e => `<li><div class="date">${dateChip(e)}</div><div><strong><a href="/events/#${e.slug}">${esc(e.title)}</a></strong><span>${esc(e.venue)}</span></div></li>`).join("")}</ul>
    <a class="btn btn-ghost" href="/submit-event/">Submit an event</a></div>
    ${sponsor("rect")}
  </aside></div>
</div></section>

<section class="block" id="directory"><div class="wrap">
  <div class="sec-head"><h2>The Alpharetta directory</h2><a href="/directory/">Browse everything</a></div>
  <div class="cats">${CATS.filter(c => counts[c.id]).slice(0, 7).map(c => `<a class="cat" href="/directory/?cat=${c.id}"><svg viewBox="0 0 64 64"><use href="#logo"/></svg><div><strong>${c.label}</strong><span>${counts[c.id]} places</span></div></a>`).join("")}<a class="cat" href="/add-your-business/"><svg viewBox="0 0 64 64"><use href="#logo"/></svg><div><strong>Add your business</strong><span>Free listing</span></div></a></div>
  <div class="sec-head" style="margin-top:48px"><h2 style="font-size:26px">Local favorites</h2><a href="/add-your-business/">Add your business</a></div>
  <div class="listings">${featured.map(listingCard).join("")}</div>
</div></section>

<section class="block equine" id="districts"><div class="wrap">
  <div class="sec-head"><h2>Avalon and Downtown Alpharetta</h2><a href="/things-to-do/">Things to do</a></div>
  <div class="eq-grid">
    <div class="countdown"><h3>Two walkable districts, one mile apart</h3><p>Avalon's shops, restaurants and seasonal ice rink sit one mile from Downtown Alpharetta's Town Green, farmers market and 50+ storefronts, connected by the paved Alpha Loop trail.</p></div>
    <ul class="eq-links">
      <li><a href="/places/avalon/">Avalon <span>Shopping and dining</span></a></li>
      <li><a href="/places/downtown-alpharetta/">Downtown Alpharetta <span>City Center</span></a></li>
      <li><a href="/places/ameris-bank-amphitheatre/">Ameris Bank Amphitheatre <span>Concerts</span></a></li>
      <li><a href="/places/alpharetta-farmers-market/">Farmers Market <span>Saturdays</span></a></li>
      <li><a href="/events/">Events calendar <span>What's on</span></a></li>
    </ul>
  </div>
</div></section>

<section class="block" id="realestate"><div class="wrap">
  <div class="sec-head"><h2>Living in Alpharetta</h2><a href="/blog/moving-to-alpharetta-ga-guide/">Moving guide</a></div>
  <div class="re-grid">
    <ul class="hoods">${["Downtown Alpharetta", "Avalon", "Windward", "Glen Abbey", "Park Bridge", "Kimball Bridge", "Crabapple", "Brookside"].map(h => `<li>${h}</li>`).join("")}</ul>
    <div>
      <div class="agent"><div><h3 class="h4" style="font-family:var(--serif);font-weight:500;font-size:24px;margin:0">The Technology City of the South</h3><p>Alpharetta is home to hundreds of technology companies, top-rated schools and some of metro Atlanta's most sought-after neighborhoods. Our moving guide covers where people live, what it costs and what to know.</p><a class="btn btn-ghost" href="/blog/moving-to-alpharetta-ga-guide/">Read the moving guide</a></div></div>
    </div>
  </div>
</div></section>
<div class="wrap">${sponsor()}</div>
${newsletter}`;
  add("/", layout({
    title: "Alpharetta List | Alpharetta, GA Restaurants, Things to Do, Events and Local Directory",
    description: "Alpharetta List is the local guide to Alpharetta, Georgia: restaurants, things to do, Avalon and Downtown Alpharetta, events, news and a directory of local businesses.",
    urlPath: "/", body,
    jsonld: [{ "@context": "https://schema.org", "@type": "WebSite", "@id": SITE + "/#website", name: "Alpharetta List", url: SITE + "/", publisher: { "@id": SITE + "/#org" },
      potentialAction: { "@type": "SearchAction", target: SITE + "/directory/?q={search_term_string}", "query-input": "required name=search_term_string" } }]
  }), "1.0");
}

// ---------- Directory (all) ----------
function directoryPage({ urlPath, crumbs, h1, sub, title, description, list, showFilters = true, intro = "" }) {
  const cats = CATS.filter(c => list.some(p => p.cat === c.id));
  const body = pageHead(crumbs, h1, sub) + `<div class="wrap">${sponsor()}</div>
<section class="wrap" style="padding-bottom:40px">
  ${intro}
  ${showFilters ? `<div class="dir-tools"><label class="sr" for="dir-q">Search the directory</label><input id="dir-q" type="search" placeholder="Search by name, cuisine or type">
  <div class="filters" role="group" aria-label="Filter by category"><button aria-pressed="true" data-f="all">All</button>${cats.map(c => `<button aria-pressed="false" data-f="${c.id}">${c.label}</button>`).join("")}</div></div>
  <p class="count-note" id="count-note" role="status">${list.length} places</p>` : ""}
  <div class="listings" data-filter-grid>${list.map(listingCard).join("")}</div>
  <div class="claim" style="margin-top:36px">Own an Alpharetta business that should be here? <a href="/add-your-business/">Add it to Alpharetta List for free</a>.</div>
</section>
<div class="wrap">${sponsor()}</div>${newsletter}`;
  const ld = [crumbsLD(crumbs), { "@context": "https://schema.org", "@type": "ItemList", name: h1, itemListElement: list.map((p, i) => ({ "@type": "ListItem", position: i + 1, url: `${SITE}/places/${p.slug}/`, name: p.name })) }];
  add(urlPath, layout({ title, description, urlPath, body, jsonld: ld }), "0.9");
}

directoryPage({
  urlPath: "/directory/", crumbs: [["Home", "/"], ["Directory", "/directory/"]],
  h1: "The Alpharetta, GA directory", sub: "Restaurants, parks, entertainment, shopping and local businesses across Alpharetta, Georgia.",
  title: "Alpharetta, GA Local Directory: Restaurants, Parks, Shopping and Businesses",
  description: "Browse Alpharetta, Georgia's local directory: restaurants, parks, entertainment, shopping, things to do and local businesses in 30004, 30005, 30009 and 30022.",
  list: places
});

const listIntro = (html) => `<div class="prose prose-narrow" style="margin-bottom:28px">${html}</div>`;
directoryPage({
  urlPath: "/restaurants/", crumbs: [["Home", "/"], ["Restaurants", "/restaurants/"]],
  h1: "The best restaurants in Alpharetta, GA", sub: "Where Alpharetta eats, from Avalon date nights to downtown brunch and late night tacos.",
  title: "Best Restaurants in Alpharetta, GA (2026 Local Guide)",
  description: "A local guide to the best restaurants in Alpharetta, Georgia: steakhouses, Southern, sushi, Italian, brunch spots, coffee and dessert, updated for 2026.",
  list: places.filter(p => p.cat === "restaurants"),
  intro: listIntro(`<p>Alpharetta's dining scene runs from the chef-driven restaurants of <a href="/places/avalon/">Avalon</a> to the porches and patios of <a href="/places/downtown-alpharetta/">Downtown Alpharetta</a>, with more along Windward Parkway and the North Point corridor. Below are the spots locals talk about most, grouped so you can filter by type.</p>`)
});
directoryPage({
  urlPath: "/things-to-do/", crumbs: [["Home", "/"], ["Things to do", "/things-to-do/"]],
  h1: "Things to do in Alpharetta, GA", sub: "Parks and trails, live music, family fun, shopping districts and easy day trips.",
  title: "Things to Do in Alpharetta, GA: Avalon, Parks, Concerts and Family Fun",
  description: "The best things to do in Alpharetta, Georgia: Avalon, Downtown Alpharetta, the Big Creek Greenway, Ameris Bank Amphitheatre concerts, Topgolf, family fun and shopping.",
  list: places.filter(p => p.cat !== "restaurants"),
  intro: listIntro(`<p>Alpharetta packs a lot into one city: start at <a href="/places/avalon/">Avalon</a> or the Town Green in <a href="/places/downtown-alpharetta/">Downtown Alpharetta</a>, walk or ride the <a href="/places/big-creek-greenway/">Big Creek Greenway</a>, catch a summer show at <a href="/places/ameris-bank-amphitheatre/">Ameris Bank Amphitheatre</a>, and let the kids loose at <a href="/places/wills-park/">Wills Park</a>. For what's on this week, see our <a href="/events/">events calendar</a>.</p>`)
});


const SERVICE_PAGES = [
  { slug: "hvac", guide: "<h2 style=\"font-family:var(--serif);font-weight:500;font-size:24px;margin:22px 0 8px\">HVAC in Alpharetta: what to know</h2><p>North Georgia asks a lot of a heating and cooling system: humid 90-degree summers, real winter freezes, and spring pollen that clogs filters fast. Most local companies recommend two tune-ups a year, one for the AC in spring and one for the furnace in fall, plus frequent filter changes during pollen season.</p><p>When replacing a system, ask contractors about SEER2 efficiency ratings, proper sizing for your home and any available Georgia Power rebates, and get at least two written quotes. Georgia licenses conditioned air contractors through the Secretary of State, so you can verify a license at sos.ga.gov before hiring.</p>", faqs: [{"q": "How often should HVAC be serviced in Alpharetta?", "a": "Most companies recommend twice a year: an AC tune-up in spring and a furnace check in fall. Change filters more often during spring pollen season."}, {"q": "How long does an HVAC system last in Georgia?", "a": "Typically about 12 to 15 years. Frequent repairs, rising power bills or uneven temperatures are signs it may be time to replace."}], noun: "HVAC and AC Repair Companies", re: /\bac\b|air condition|hvac|heating|duct|furnace/i, blurb: "AC repair, furnace service, new system installation and maintenance plans", tips: ["Book maintenance in spring before the summer rush", "Ask about maintenance plans, which often include priority service", "Get a written quote and ask about SEER2 ratings and Georgia Power rebates on new systems"] },
  { slug: "plumbers", guide: "<h2 style=\"font-family:var(--serif);font-weight:500;font-size:24px;margin:22px 0 8px\">Plumbing in Alpharetta: what to know</h2><p>Alpharetta's housing stock ranges from 1980s neighborhoods to brand-new townhomes, so local plumbers see everything from aging polybutylene supply lines and original water heaters to tankless installs in new builds. Water heaters in garages and basements are the most common emergency call, along with clogged main lines and running toilets.</p><p>Georgia licenses plumbers at the state level, so check the company's master plumber license at sos.ga.gov, confirm they are insured, and get the trip fee and after-hours rates in writing before anyone is dispatched. In a leak emergency, shut off your main water valve first, then call.</p>", faqs: [{"q": "Do plumbers need a license in Georgia?", "a": "Yes. Georgia licenses journeyman and master plumbers through the Secretary of State. You can verify a license at sos.ga.gov before hiring."}, {"q": "Do I need a permit to replace a water heater in Alpharetta?", "a": "Water heater replacement generally requires a plumbing permit through the City of Alpharetta, and a licensed plumber normally pulls it. Confirm with the city's Community Development department."}], noun: "Plumbers", re: /plumb|rooter/i, blurb: "drain cleaning, leaks, water heaters, sewer lines and emergency repairs", tips: ["Confirm the plumber holds a Georgia license and carries insurance", "Ask whether they charge a trip fee and whether after-hours rates apply", "For older Alpharetta homes, ask about repiping and water heater replacement options"] },
  { slug: "dentists", noun: "Dentists", re: /dent|orthodont|endodont|oral surg|implant/i, cats: ["health"], blurb: "family, pediatric and cosmetic dentistry, orthodontics and implants", tips: ["Call ahead to confirm your dental insurance is accepted", "Ask about new patient specials and emergency appointments", "Several Alpharetta practices offer in-house savings plans for uninsured patients"] },
  { slug: "veterinarians", noun: "Veterinarians", re: /veterin|vet\b|animal/i, cats: ["pets"], blurb: "vets, animal hospitals, specialty care and 24/7 emergency clinics", tips: ["Ask about after-hours and emergency options before you need them", "Bring vaccination and medical records to your first visit", "Alpharetta has 24/7 emergency and specialty hospitals for serious cases"] },
  { slug: "auto-repair", guide: "<h2 style=\"font-family:var(--serif);font-weight:500;font-size:24px;margin:22px 0 8px\">Auto repair in Alpharetta: what to know</h2><p>Alpharetta has an unusually deep bench of independent shops that specialize in European and Japanese vehicles, which fits a city full of them. Georgia summers are hard on batteries, tires and air conditioning, so many drivers have AC systems checked before the heat arrives.</p><p>Ask for a written estimate before work begins, ask whether the shop uses OEM or aftermarket parts, and check whether loaner cars or shuttle service are offered for longer jobs.</p>", faqs: [{"q": "Are there shops in Alpharetta that work on European cars?", "a": "Yes. Several independent Alpharetta shops specialize in German and other European makes, alongside Japanese-vehicle specialists. Call ahead to confirm they work on your make."}], noun: "Auto Repair Shops", re: /auto|tire|car repair|brake/i, blurb: "auto repair, maintenance, tires, brakes and European and Japanese specialists", tips: ["Ask for a written estimate before repairs begin", "Ask whether the shop specializes in your make", "Have the AC and battery checked before summer"] },
  { slug: "gyms", noun: "Gyms and Fitness Studios", re: /gym|fitness|pilates|yoga|training|strength|boot camp|athletic club/i, cats: ["fitness"], blurb: "gyms, strength studios, Pilates, yoga and personal training", tips: ["Most gyms offer a free trial class or day pass", "Ask about contract length and cancellation terms", "Boutique studios cap class sizes, so book popular times ahead"] },
  { slug: "nail-salons", noun: "Nail Salons", re: /nail/i, cats: ["beauty"], blurb: "manicures, pedicures, gel, dip and nail art", tips: ["Walk-ins are easier on weekday mornings", "Ask about sanitation practices and tool sterilization", "Book ahead before holidays and events"] },
  { slug: "med-spas", guide: "<h2 style=\"font-family:var(--serif);font-weight:500;font-size:24px;margin:22px 0 8px\">Choosing a med spa in Alpharetta</h2><p>Alpharetta's spas and med spas cluster around Avalon, downtown and the Windward and North Point corridors. Common treatments include facials, injectables, laser treatments, cryotherapy, IV therapy and infrared sauna. Ask who will perform your treatment, what training and licensing they have and which devices they use, and book a consultation before committing to a package.</p>", faqs: [{"q": "What treatments do Alpharetta med spas offer?", "a": "Common offerings include facials, injectables, laser treatments, body contouring, cryotherapy, IV therapy and infrared sauna. Menus vary, so check the spa's site or call."}, {"q": "How do I choose a safe med spa?", "a": "Ask who performs injectables and lasers and what their medical license and training are, confirm physician oversight, and start with a consultation before buying a package."}], noun: "Spas and Med Spas", re: /\bspa\b|med spa|wellness|massage|facial/i, cats: ["beauty", "fitness"], blurb: "day spas, med spas, massage, facials and recovery treatments", tips: ["Ask who performs treatments and their credentials", "Book a consultation before committing to a treatment plan", "Ask about package pricing for recurring treatments"] },
  { slug: "real-estate-agents", noun: "Real Estate Agents", re: /real estate|realty|broker/i, cats: ["realestate"], blurb: "agents and teams who know Alpharetta neighborhoods, schools and new construction", tips: ["Ask which Alpharetta neighborhoods and school zones the agent knows best", "New construction and luxury properties often need a specialist", "Ask for recent comparable sales before pricing or making an offer"] },
  { slug: "kids-activities", noun: "Kids Activities and Classes", re: /gymnastics|ninja|music|martial|karate|taekwondo|krav|boxing|tumbling|lessons/i, cats: ["kids", "fitness"], blurb: "gymnastics, music lessons, martial arts and after-school programs", tips: ["Ask about trial classes before committing to a season", "Check class sizes and instructor certifications", "Summer camps fill early, so register in spring"] },
  { slug: "electricians", noun: "Electricians", re: /electric/i, cats: ["home"], blurb: "electrical repairs, panel upgrades, lighting, generators and EV chargers", tips: ["Hire a licensed Georgia electrical contractor for anything beyond basic fixtures", "Ask about EV charger installs and whole-home surge protection", "Get permits pulled for panel upgrades and new circuits"] },
  { slug: "roofers", noun: "Roofers", re: /roof/i, cats: ["home"], blurb: "shingle and metal roofs, repairs, replacements and storm damage", tips: ["Ask for proof of licensing and insurance before work begins", "Get photos of any damage and a written scope, especially for insurance claims", "After hail or wind storms, be wary of door-knocking out-of-town crews"] },
  { slug: "tree-service", noun: "Tree Services", re: /tree serv|stump|arborist|tree seed/i, cats: ["home"], blurb: "tree trimming, tree removal, stump grinding and storm cleanup", tips: ["Look for an ISA Certified Arborist and ask for proof of liability and workers comp insurance", "Get the scope in writing, including debris haul-away and stump grinding", "Schedule structural pruning before summer storm season"] },
  { slug: "pest-control", noun: "Pest Control Companies", re: /pest|exterminat|wildlife/i, cats: ["home"], blurb: "ants, termites, roaches, rodents, mosquitoes and wildlife removal", tips: ["Ask whether treatments are pet and child friendly", "Compare one-time treatments with quarterly plans", "Termite inspections are worth scheduling before buying a home"] },
  { slug: "landscaping", noun: "Landscaping and Lawn Care Companies", re: /landscap|lawn/i, cats: ["home"], blurb: "lawn care, landscape design and installation, and maintenance", tips: ["Check your HOA's landscaping rules before major changes", "Ask about irrigation checks heading into summer", "Get itemized quotes for design-and-install projects"] },
  { slug: "orthodontists", noun: "Orthodontists", re: /orthodont/i, cats: ["health"], blurb: "braces and clear aligners for kids, teens and adults", tips: ["Most orthodontists offer a free consultation, so compare two", "Ask about total treatment cost, payment plans and what retainers cost after", "Check whether your dental plan includes an orthodontic benefit"] },
  { slug: "pediatricians", noun: "Pediatricians", re: /pediatric(?!\s*dent)|pediatrics/i, cats: ["health"], blurb: "well-child visits, vaccines, sick visits and sports physicals", tips: ["Call ahead to confirm the practice is accepting new patients and takes your insurance", "Ask about same-day sick visits and after-hours phone lines", "Schedule back-to-school and sports physicals early in the summer"] },
  { slug: "urgent-care", noun: "Urgent Care Clinics", re: /urgent|hospital|medical campus/i, cats: ["health"], blurb: "walk-in care for minor injuries and illnesses, with X-ray and labs", tips: ["For emergencies, call 911 or go to the nearest emergency room", "Urgent care handles minor injuries, illnesses, stitches and X-rays", "Check in online where offered to cut your wait"] },
  { slug: "physical-therapy", noun: "Physical Therapists", re: /physical therapy|physiotherapy|rehabilitation/i, cats: ["health"], blurb: "injury rehab, post-surgical recovery and sports performance", tips: ["Georgia allows direct access to PT, but your insurance may still want a referral", "Ask how much one-on-one time you get with the therapist each visit", "Consistency matters, so pick a clinic close to home or work"] },
  { slug: "chiropractors", noun: "Chiropractors", re: /chiropract|spine/i, cats: ["health"], blurb: "spinal adjustments, back and neck pain and injury care", tips: ["Ask about the exam and imaging process before treatment starts", "Check whether your insurance covers chiropractic visits", "Be cautious of long prepaid treatment packages on day one"] },
  { slug: "counseling", noun: "Counselors and Therapists", re: /counsel|psychotherapy|therapy(?!.*physical)/i, cats: ["health"], blurb: "individual, couples and family counseling", tips: ["Ask about the therapist's licensure and areas of focus", "Check whether they take your insurance or offer superbills", "Many practices offer a brief free phone consult to check fit"] },
  { slug: "accountants", noun: "CPAs and Accountants", re: /cpa|account|tax/i, cats: ["services"], blurb: "tax preparation and planning, bookkeeping, payroll and CFO services", tips: ["Book early, since calendars fill fast before tax deadlines", "Ask whether they specialize in your situation, such as small business or equity compensation", "Confirm who actually prepares your return and how questions are handled year-round"] },
  { slug: "financial-advisors", noun: "Financial Advisors", re: /financial advisor|wealth/i, cats: ["services"], blurb: "retirement planning, investments and wealth management", tips: ["Ask whether the advisor is a fiduciary and how they are paid", "Compare fee-only, fee-based and commission models", "Check credentials like CFP and the firm's Form ADV"] },
  { slug: "law-firms", noun: "Law Firms", re: /law\b|attorney|legal/i, cats: ["services"], blurb: "family law, estate planning, probate and business matters", tips: ["Most firms offer an initial consultation, so ask what it costs", "Ask who will actually handle your case day to day", "Get the fee structure in writing, whether hourly, flat or contingency"] },
  { slug: "preschools", noun: "Preschools and Daycares", re: /preschool|montessori|goddard|kindercare|academy alpharetta/i, cats: ["schools", "kids"], blurb: "preschool, pre-K, Montessori and early learning programs", tips: ["Tour at drop-off or pickup time to see the real routine", "Ask about teacher ratios, turnover and curriculum approach", "Waitlists are common, so start looking six months or more ahead"] }
];
const SVC_CATS = ["home", "health", "pets", "realestate", "fitness", "beauty", "services", "kids", "schools"];
const servicePagesBuilt = [];
for (const sp of SERVICE_PAGES) {
  const list = places.filter(p => (sp.cats || SVC_CATS).includes(p.cat) && sp.re.test(p.type + " " + p.name));
  if (list.length < 2) continue;
  servicePagesBuilt.push({ ...sp, count: list.length });
  const url = `/services/${sp.slug}/`;
  const faqs = [
    { q: `How do I find the best ${sp.noun.toLowerCase()} in Alpharetta, GA?`, a: `Start with providers based in or regularly serving Alpharetta, check licensing and reviews, and get more than one quote for bigger jobs. This page lists ${list.length} options for ${sp.blurb}.` },
    ...(sp.faqs || []),
    { q: `Do these ${sp.noun.toLowerCase()} serve all of Alpharetta?`, a: `Most serve all Alpharetta ZIP codes, including 30004, 30005, 30009 and 30022, plus nearby Milton, Roswell and Johns Creek. Call to confirm they cover your address.` }
  ];
  const intro = listIntro(`<p>Looking for the best ${sp.noun.toLowerCase()} in Alpharetta, Georgia? Here are ${list.length} local providers for ${sp.blurb} in and around Alpharetta, with addresses and phone numbers where available.</p>${sp.guide || ""}<h2 style="font-family:var(--serif);font-weight:500;font-size:24px;margin:22px 0 8px">Tips for hiring ${sp.noun.toLowerCase()} in Alpharetta</h2><ul>${sp.tips.map(t => `<li>${t}</li>`).join("")}</ul><p>Own one of these businesses? <a href="/add-your-business/">Claim or add your listing</a> for free.</p>`)
    + `<div class="prose prose-narrow" style="margin:28px 0"><h2 style="font-family:var(--serif);font-weight:500;font-size:24px">Frequently asked questions</h2>${faqs.map(f => `<h3 style="font-size:17px;margin:16px 0 4px">${f.q}</h3><p>${f.a}</p>`).join("")}</div>`;
  directoryPage({
    urlPath: url, crumbs: [["Home", "/"], ["Local services", "/services/"], [sp.noun, url]],
    h1: `Best ${sp.noun} in Alpharetta, GA`, sub: `Local ${sp.noun.toLowerCase()} serving Alpharetta and North Fulton: ${sp.blurb}.`,
    title: `Best ${sp.noun} in Alpharetta, GA (${new Date(BUILD_DATE).getFullYear()} Guide)`,
    description: `Find the best ${sp.noun.toLowerCase()} in Alpharetta, Georgia: ${list.length} local options for ${sp.blurb}, with addresses, phone numbers and hiring tips.`,
    list, showFilters: false, intro
  });
}
const serviceLinks = `<div class="prose prose-narrow" style="margin-bottom:24px"><h2 style="font-family:var(--serif);font-weight:500;font-size:24px">Browse by service</h2><p>${SERVICE_PAGES.filter(sp => places.filter(p => (sp.cats || SVC_CATS).includes(p.cat) && sp.re.test(p.type + " " + p.name)).length >= 2).map(sp => `<a href="/services/${sp.slug}/">${sp.noun}</a>`).join(" &middot; ")}</p></div>`;
directoryPage({
  urlPath: "/services/", crumbs: [["Home", "/"], ["Local services", "/services/"]],
  h1: "Local services in Alpharetta, GA", sub: "HVAC and plumbing, dentists, veterinarians, gyms, spas and real estate, serving Alpharetta and North Fulton.",
  title: "Alpharetta, GA Local Services: HVAC, Plumbers, Dentists, Vets, Gyms and More",
  description: "Find local services in Alpharetta, Georgia: HVAC and AC repair, plumbers, dentists, veterinarians, gyms, spas, kids classes and real estate teams.",
  list: places.filter(p => ["home", "health", "pets", "realestate", "fitness", "beauty", "kids", "services", "schools"].includes(p.cat)),
  intro: listIntro(`<p>From AC repair in the middle of August to a vet on a Saturday morning, these are local providers in and around Alpharetta. Listings include the business address and phone where available. Own an Alpharetta business? <a href="/add-your-business/">Add it free</a>, and providers can claim their listing to add hours, photos and services.</p>`) + serviceLinks
});

// ---------- Place pages ----------
const AREA_TEXT = {
  "Downtown Alpharetta": "in Downtown Alpharetta, the walkable City Center district around Main Street and the Town Green",
  "Avalon": "at Avalon, Alpharetta's upscale mixed-use shopping and dining district on Old Milton Parkway",
  "Windward": "in the Windward Parkway area on Alpharetta's north side, near GA 400 exit 11",
  "North Point": "in the North Point corridor along North Point Parkway, near the mall and GA 400 exit 10",
  "Old Milton Pkwy": "on Old Milton Parkway, the corridor that links GA 400 with Avalon and downtown",
  "North Main St": "on North Main Street, just up Highway 9 from Downtown Alpharetta",
  "Crabapple": "in the Crabapple area on Alpharetta's west side, near the Milton line",
  "Haynes Bridge": "in the Haynes Bridge Road area near GA 400",
  "McGinnis Ferry": "along McGinnis Ferry Road on Alpharetta's east side, near the Johns Creek line",
  "Encore Park": "at Encore Park on Encore Parkway, home of Ameris Bank Amphitheatre",
  "McFarland Pkwy": "on McFarland Parkway at Alpharetta's northern edge"
};
const CAT_TIPS = {
  restaurants: ["Hours and menus change, so check the restaurant's website or call ahead before you go", "Weekend evenings at Avalon and downtown are the busiest times, so book ahead", "Many Alpharetta restaurants offer takeout and delivery through their own sites"],
  home: ["Ask whether the company is licensed and insured in Georgia before work begins", "Get a written estimate, and compare at least two quotes for bigger jobs", "Ask about maintenance plans, which can lower costs over time"],
  health: ["Call ahead to confirm they accept your insurance", "Ask about new patient availability and wait times", "For emergencies, call 911 or go to the nearest emergency room"],
  pets: ["Call ahead to confirm new patient availability", "Bring your pet's vaccination and medical records to the first visit", "Ask about after-hours and emergency options"],
  realestate: ["Ask which Alpharetta neighborhoods and school zones the agent knows best", "New construction and luxury properties often need a specialist", "Ask for recent comparable sales before pricing or making an offer"]
};
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; } };
for (const p of places) {
  const listUrl = p.cat === "restaurants" ? "/restaurants/" : `/directory/?cat=${p.cat}`;
  const crumbs = [["Home", "/"], [catLabel(p.cat), listUrl], [p.name, `/places/${p.slug}/`]];
  const sameType = places.filter(x => x.slug !== p.slug && x.cat === p.cat && (p.cuisine ? x.cuisine === p.cuisine : x.type === p.type)).slice(0, 4);
  const nearby = places.filter(x => x.slug !== p.slug && p.area && x.area === p.area && !sameType.includes(x)).slice(0, 4);
  const more = sameType.length + nearby.length < 4 ? places.filter(x => x.slug !== p.slug && x.cat === p.cat && !sameType.includes(x) && !nearby.includes(x)).slice(0, 4 - sameType.length - nearby.length) : [];
  const street = p.address && /^\d/.test(p.address) ? p.address : "";
  const addrParts = street.match(/^(.*),\s*([^,]+),\s*GA\s*(\d{5})$/);
  const isNearby = (p.area || "").includes("nearby");
  const city = isNearby && p.address ? p.address.split(",").slice(-2, -1)[0].trim() : "Alpharetta";
  const areaText = AREA_TEXT[p.area] || (isNearby ? `a short drive from Alpharetta in ${city}` : "in Alpharetta, Georgia");
  const kind = p.cat === "restaurants" ? (p.cuisine ? p.cuisine.toLowerCase() + " " : "") + (/(bar|tavern|saloon|lounge)/i.test(p.type) ? "spot" : "restaurant") : p.type.toLowerCase();
  const tips = (p.tips && p.tips.length ? p.tips : CAT_TIPS[p.cat] || []);
  const faq = [
    { q: `Where is ${p.name} located?`, a: p.address ? `${p.name} is located at ${p.address}, ${areaText}.` : `${p.name} is ${areaText}. Use the directions button for the exact location.` },
    ...(p.cat === "restaurants" ? [{ q: `What kind of food does ${p.name} serve?`, a: `${p.name} is a ${p.type.toLowerCase()} spot in ${city}. ${p.desc}` }] : [{ q: `What does ${p.name} offer?`, a: `${p.name} is listed under ${catLabel(p.cat).toLowerCase()} (${p.type.toLowerCase()}). ${p.desc}` }]),
    { q: `What are ${p.name}'s hours?`, a: p.hours ? `${p.name} hours: ${p.hours}. Hours can change on holidays, so ${p.phone ? "call " + p.phone : "check ahead"} to confirm.` : p.website ? `Hours can change seasonally, so check ${hostOf(p.website)} or call ahead before visiting.` : `Hours can change seasonally, so call ahead or check the business's official listing before visiting.` },
    ...(p.phone ? [{ q: `What is the phone number for ${p.name}?`, a: `You can reach ${p.name} at ${p.phone}.` }] : [])
  ];
  const ldPlace = {
    "@context": "https://schema.org", "@type": p.schema || "LocalBusiness", name: p.name, description: p.desc, url: `${SITE}/places/${p.slug}/`,
    ...(addrParts ? { address: { "@type": "PostalAddress", streetAddress: addrParts[1], addressLocality: addrParts[2], addressRegion: "GA", postalCode: addrParts[3], addressCountry: "US" } } : { address: { "@type": "PostalAddress", addressLocality: isNearby ? city : "Alpharetta", addressRegion: "GA", addressCountry: "US" } }),
    ...(p.phone ? { telephone: p.phone } : {}), ...(p.openingHours ? { openingHours: p.openingHours } : {}), ...(p.priceRange ? { priceRange: p.priceRange } : {}), ...(p.cuisine ? { servesCuisine: p.cuisine } : {}), ...(p.website ? { sameAs: [p.website] } : {})
  };
  const ldFaq = { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: faq.map(f => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })) };
  const telHref = p.phone ? "tel:+1" + p.phone.replace(/\D/g, "").replace(/^1/, "") : "";
  const actions = `<div class="pl-actions"><a class="btn btn-primary" href="${mapsLink(p)}" rel="noopener" target="_blank">Get directions</a>${p.phone ? `<a class="btn btn-ghost" href="${telHref}">Call ${esc(p.phone)}</a>` : ""}${p.website ? `<a class="btn btn-ghost" href="${esc(p.website)}" rel="noopener nofollow" target="_blank">Visit website</a>` : ""}</div>`;
  const facts = `<dl class="pl-facts">
      <div><dt>Category</dt><dd><a href="${listUrl}">${esc(catLabel(p.cat))}</a></dd></div>
      <div><dt>Type</dt><dd>${esc(p.type)}</dd></div>
      <div><dt>${p.address ? "Address" : "Area"}</dt><dd>${esc(p.address || p.area || "Alpharetta, GA")}</dd></div>
      ${p.hours ? `<div><dt>Hours</dt><dd>${esc(p.hours)}</dd></div>` : ""}
      ${p.phone ? `<div><dt>Phone</dt><dd><a href="${telHref}">${esc(p.phone)}</a></dd></div>` : ""}
      ${p.website ? `<div><dt>Website</dt><dd><a href="${esc(p.website)}" rel="noopener nofollow" target="_blank">${esc(hostOf(p.website))}</a></dd></div>` : ""}
    </dl>`;
  const miniList = (title, list) => list.length ? `<section class="pl-section"><h2>${title}</h2><ul class="pl-mini">${list.map(x => `<li><a href="/places/${x.slug}/"><strong>${esc(x.name)}</strong><span>${esc(x.type)}${x.area ? " &middot; " + esc(x.area) : ""}</span></a></li>`).join("")}</ul></section>` : "";
  const extras = [p.hours ? "Hours" : "", p.phone ? "Phone" : "", p.cat === "restaurants" ? "Menu" : "", street ? "Address" : ""].filter(Boolean).slice(0, 3);
  const nameHasCity = new RegExp(city, "i").test(p.name);
  const lead = nameHasCity ? `${p.name} in ${city}, GA` : `${p.name} ${city}, GA`;
  const title = p.title || ((p.hours || p.phone) && p.cat !== "coming-soon" ? `${lead}: ${extras.join(", ").replace(/, ([^,]*)$/, " & $1")}` : `${p.name}, ${city} GA: ${p.type}${p.cat === "restaurants" && street ? ", " + street.split(",")[0] : ""}`);
  const body = `
<section class="pl-head"><div class="wrap">
  ${crumbsHTML(crumbs)}
  <div class="pl-title"><div><span class="pill ver" style="background:rgba(255,255,255,.14);color:#fff">${esc(catLabel(p.cat))}</span><h1>${esc(p.name)}</h1><p>${esc(p.type)}${p.area ? " &middot; " + esc(p.area) : ""}</p></div></div>
  ${actions}
</div></section>
<div class="wrap">${sponsor()}</div>
<div class="wrap pl-grid">
  <article class="pl-main">
    <section class="pl-section"><h2>About ${esc(p.name)}</h2>
      ${p.status ? `<p class="pl-lede" style="border-left:4px solid #c9a227;padding-left:12px"><strong>Status:</strong> ${esc(p.status)}</p>` : ""}
      <p class="pl-lede">${esc(p.desc)}</p>
      <p>${esc(p.name)} is ${areaText}. ${p.cat === "restaurants" ? `It is one of ${places.filter(x => x.cat === "restaurants").length} places to eat and drink in our <a href="/restaurants/">Alpharetta restaurant guide</a>${p.cuisine ? `, and part of the city's ${esc(p.cuisine)} dining scene` : ""}.` : `Browse more ${esc(catLabel(p.cat).toLowerCase())} in our <a href="${listUrl}">Alpharetta directory</a>.`}</p>
      ${p.link ? `<p><a href="${p.link}">Read our full guide</a></p>` : ""}
    </section>
    ${(postsByPlace[p.slug] || []).length ? `<section class="pl-section"><h2>Featured in our Alpharetta guides</h2><ul class="tips">${postsByPlace[p.slug].slice(0, 6).map(x => `<li><a href="/blog/${x.slug}/">${esc(x.h1)}</a></li>`).join("")}</ul></section>` : ""}
    ${tips.length ? `<section class="pl-section"><h2>Good to know</h2><ul class="tips">${tips.map(t => `<li>${esc(t)}</li>`).join("")}</ul></section>` : ""}
    <section class="pl-section"><h2>Frequently asked questions</h2><div class="faq" style="margin-top:0">${faq.map(f => `<details><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join("")}</div></section>
    ${miniList(p.cuisine ? `More ${esc(p.cuisine)} spots in Alpharetta` : `Similar ${esc(catLabel(p.cat).toLowerCase())}`, sameType.concat(more))}
    ${miniList(`Also ${p.area && !isNearby ? "on " + esc(p.area) : "nearby"}`, nearby)}
    <div class="claim">Own or manage ${esc(p.name)}? <a href="/add-your-business/?claim=${p.slug}">Claim this listing</a> to add photos, hours and your menu or services, or <a href="/add-your-business/?claim=${p.slug}">suggest an edit</a>.</div>
  </article>
  <aside><div class="sticky-rail">
    <div class="pl-card">
      <h2>At a glance</h2>
      ${facts}
      <a class="btn btn-primary" style="width:100%" href="${mapsLink(p)}" rel="noopener" target="_blank">Get directions</a>
    </div>
  </div></aside>
</div>
<div class="wrap">${sponsor()}</div>${newsletter}`;
  const firstSentence = p.desc.split(/(?<=[a-z]{3}\.)\s/)[0];
  const cut = (t, n) => t.length <= n ? t : t.slice(0, n - 3).replace(/[\s,;:]+\S*$/, "") + "...";
  let tail = [street ? `${street.split(",")[0]}, ${city}.` : "", p.phone ? `Call ${p.phone}.` : ""].filter(Boolean).join(" ");
  if (p.hours && (tail + p.hours).length < 75) tail = `${tail} Hours: ${p.hours.replace(/\.$/, "")}.`.trim();
  const budget = Math.max(80, 158 - tail.length - 1);
  let desc = cut(firstSentence, budget);
  if ((desc + " " + tail).length <= 160) desc = (desc + " " + tail).trim();
  if (p.meta) desc = p.meta;
  add(`/places/${p.slug}/`, layout({ title, description: desc, urlPath: `/places/${p.slug}/`, body, jsonld: [crumbsLD(crumbs), ldPlace, ldFaq] }), "0.6");
}

// ---------- Events ----------
{
  const crumbs = [["Home", "/"], ["Events", "/events/"]];
  const evLD = events.map(e => ({ "@context": "https://schema.org", "@type": "Event", name: e.title, startDate: e.start, endDate: e.end || e.start, eventStatus: "https://schema.org/EventScheduled", eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode", description: e.desc,
    location: { "@type": "Place", name: e.venue, address: e.address || "Alpharetta, GA" }, ...(e.url ? { url: e.url } : {}),
    image: [e.image ? SITE + e.image : SITE + "/assets/og.jpg"],
    organizer: { "@type": "Organization", name: e.organizer || e.venue, url: e.organizerUrl || e.url || SITE + "/events/" },
    performer: { "@type": "PerformingGroup", name: e.performer || e.title },
    offers: { "@type": "Offer", url: e.url || SITE + "/events/#" + e.slug, availability: "https://schema.org/InStock", validFrom: e.start, ...(e.price !== undefined ? { price: String(e.price), priceCurrency: "USD" } : {}) } }));
  const body = pageHead(crumbs, "Events in Alpharetta, GA", "Festivals, concerts, markets and community events happening in and around Alpharetta.") + `<div class="wrap">${sponsor()}</div>
<div class="wrap body-grid"><div>
  <ul class="event-list">${events.map(e => `<li class="event-item" id="${e.slug}"><div class="date">${dateChip(e, true)}</div>
    <div><h3>${esc(e.title)}</h3><div class="when">${e.dateNote ? esc(e.dateNote) : fmtDate(e.start) + (e.end && e.end !== e.start ? " to " + fmtDate(e.end) : "")}</div>
    <p>${esc(e.desc)}</p><p><strong>${e.venueSlug ? `<a href="/places/${e.venueSlug}/">${esc(e.venue)}</a>` : esc(e.venue)}</strong>${e.address ? ", " + esc(e.address) : ""}</p>${e.url ? `<p><a href="${esc(e.url)}" rel="noopener" target="_blank">Event details</a></p>` : ""}</div></li>`).join("")}</ul>
  <div class="claim" style="margin-top:32px">Hosting something in Alpharetta? <a href="/submit-event/">Submit your event</a> and we will add it to the calendar for free.</div>
</div><aside><div class="sticky-rail">${sponsor("rect")}</div></aside></div>
<div class="wrap">${sponsor()}</div>${newsletter}`;
  add("/events/", layout({ title: "Alpharetta, GA Events Calendar 2026 to 2027: Festivals, Markets and Concerts", description: "Upcoming events in Alpharetta, Georgia: the farmers market, Food Truck Alley, holiday celebrations at Avalon and downtown, festivals and community events.", urlPath: "/events/", body, jsonld: [crumbsLD(crumbs), ...evLD] }), "0.9");
}

// ---------- Blog ----------
{
  const crumbs = [["Home", "/"], ["News", "/blog/"]];
  const body = pageHead(crumbs, "Alpharetta news and guides", "New openings, development updates, local guides, events and everything happening in Alpharetta, Georgia.") + `<div class="wrap">${sponsor()}</div>
<section class="wrap" style="padding:20px 0 48px"><div class="post-grid">${posts.map(postCard).join("")}</div></section>
<div class="wrap">${sponsor()}</div>${newsletter}`;
  add("/blog/", layout({ title: "Alpharetta, GA News and Local Guides | Alpharetta List", description: "Local news and guides for Alpharetta, Georgia: new restaurants, Avalon and downtown updates, things to do, events and more.", urlPath: "/blog/", body, jsonld: [crumbsLD(crumbs)] }), "0.9");

  for (const p of posts) {
    const urlPath = `/blog/${p.slug}/`;
    const crumbsP = [["Home", "/"], ["News", "/blog/"], [p.h1, urlPath]];
    const content = read(`content/blog/${p.slug}.html`);
    const toc = [...content.matchAll(/<h2 id="([^"]+)">(.*?)<\/h2>/g)];
    const others = relatedPosts(p, 6);
    const body = pageHead(crumbsP, esc(p.h1), "", `<div class="article-meta"><span>By Alpharetta List staff</span><span>Published <time datetime="${p.published}">${fmtDate(p.published)}</time></span>${p.updated !== p.published ? `<span>Updated <time datetime="${p.updated}">${fmtDate(p.updated)}</time></span>` : ""}<span>${p.readMins} min read</span></div>`) + `<div class="wrap">${sponsor()}</div>
<div class="wrap body-grid">
  <article class="prose">
    ${coverFile(p) ? `<figure class="cover">${coverImg(p, true)}</figure>` : ""}
    ${content}
    <section class="faq" id="faq"><h2>Frequently asked questions</h2>${p.faq.map(f => `<details><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join("")}</section>
    <section class="sources"><h2 style="font-size:20px">Sources</h2><ul>${p.sources.map(s => `<li><a href="${esc(s.url)}" rel="noopener" target="_blank">${esc(s.name)}</a></li>`).join("")}</ul>
    <p>Details on developments and schools can change. We update this guide as new information is announced. Spot something out of date? <a href="/submit-event/">Send us a tip</a>.</p></section>
    <div class="author-box"><span class="logo-tile"><svg width="36" height="36" viewBox="0 0 64 64"><use href="#logo"/></svg></span><span>Written by the Alpharetta List team, an independent local guide covering Alpharetta, Georgia.</span></div>
    ${others.length ? `<div class="related"><h2>Keep reading</h2><div class="post-grid">${others.map(postCard).join("")}</div></div>` : ""}
  </article>
  <aside><div class="sticky-rail">
    ${toc.length ? `<nav class="toc" aria-label="In this article"><h2>In this article</h2><ol>${toc.map(m => `<li><a href="#${m[1]}">${m[2]}</a></li>`).join("")}<li><a href="#faq">FAQ</a></li></ol></nav>` : ""}
    <div style="margin-top:24px">${sponsor("rect")}</div>
  </div></aside>
</div>
<div class="wrap">${sponsor()}</div>${newsletter}`;
    const ld = [crumbsLD(crumbsP),
      { "@context": "https://schema.org", "@type": "NewsArticle", headline: p.title.slice(0, 110), description: p.description, datePublished: p.published, dateModified: p.updated, mainEntityOfPage: SITE + urlPath, image: [SITE + (coverFile(p) || "/assets/og.jpg")],
        author: { "@type": "Organization", name: "Alpharetta List", url: SITE + "/about/" }, publisher: { "@id": SITE + "/#org" }, about: { "@type": "Place", name: "Alpharetta, Georgia" } },
      { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: p.faq.map(f => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })) }];
    add(urlPath, layout({ title: p.seoTitle, description: p.description, urlPath, body, jsonld: ld, ogType: "article", article: p, image: coverFile(p) }), "0.8", p.updated);
  }
}

// ---------- Forms ----------
const formPage = ({ urlPath, crumb, h1, sub, title, description, form, side }) => {
  const crumbs = [["Home", "/"], [crumb, urlPath]];
  const body = pageHead(crumbs, h1, sub) + `<div class="wrap body-grid"><div>${form}</div><aside><div class="sticky-rail">${side || sponsor("rect")}</div></aside></div>${newsletter}`;
  add(urlPath, layout({ title, description, urlPath, body, jsonld: [crumbsLD(crumbs)] }), "0.5");
};
const hp = `<span class="hp"><label>Leave blank<input name="website_url_hp" tabindex="-1" autocomplete="off"></label></span>`;
const catOptions = CATS.filter(c => c.id !== "coming-soon" && c.id !== "nearby").map(c => `<option>${c.label}</option>`).join("");

formPage({
  urlPath: "/add-your-business/", crumb: "Add your business", h1: "Add your business to Alpharetta List",
  sub: "Free listings for Alpharetta businesses. Submit your details and we will review and publish your listing, usually within a few days.",
  title: "Add Your Business to Alpharetta List | Free Alpharetta, GA Business Listing",
  description: "Get your Alpharetta, Georgia business listed free on Alpharetta List, the local directory for Alpharetta residents. Claim or update an existing listing.",
  form: `<form class="form" data-wl-form="Businesses" data-success="Thanks! We received your listing and will review it shortly.">
    <input type="hidden" name="claim_listing" value="">
    <div class="row"><label>Business name<input name="business_name" required></label><label>Category<select name="category" required><option value="">Choose one</option>${catOptions}</select></label></div>
    <div class="row"><label>Type of business <span class="hint">For example: sushi, pool service, pediatrics</span><input name="subcategory"></label><label>Phone<input name="phone" type="tel" autocomplete="tel"></label></div>
    <label>Street address<input name="address" placeholder="123 S Main St, Alpharetta, GA 30009"></label>
    <div class="row"><label>Website<input name="website" type="url" placeholder="https://"></label><label>Your email <span class="hint">Not published</span><input name="email" type="email" required autocomplete="email"></label></div>
    <label>Short description <span class="hint">Two or three sentences about what you do</span><textarea name="description" maxlength="600"></textarea></label>
    ${hp}<button class="btn btn-primary" type="submit">Submit listing</button><div class="status" role="status"></div></form>`,
  side: `<div class="info-card"><strong>What happens next</strong><ul class="tips"><li>We verify the business is in or serves Alpharetta</li><li>Your listing goes live with its own page</li><li>Spot an error on an existing listing? Use this form to suggest an edit</li></ul></div>`
});
formPage({
  urlPath: "/submit-event/", crumb: "Submit an event", h1: "Submit an Alpharetta event",
  sub: "Community events, fundraisers, grand openings, shows and classes in or near Alpharetta. Free to submit.",
  title: "Submit an Event | Alpharetta, GA Events Calendar",
  description: "Add your Alpharetta, Georgia event to the Alpharetta List events calendar for free. Community events, fundraisers, grand openings and more.",
  form: `<form class="form" data-wl-form="Events" data-success="Thanks! Your event was submitted and will appear after a quick review.">
    <label>Event name<input name="event_name" required></label>
    <div class="row"><label>Start date<input name="start_date" type="date" required></label><label>End date <span class="hint">Optional</span><input name="end_date" type="date"></label></div>
    <div class="row"><label>Start time<input name="start_time" type="time"></label><label>Venue<input name="venue" required></label></div>
    <label>Address<input name="address"></label>
    <div class="row"><label>Event link<input name="link" type="url" placeholder="https://"></label><label>Your email <span class="hint">Not published</span><input name="email" type="email" required autocomplete="email"></label></div>
    <label>Description<textarea name="description" maxlength="800"></textarea></label>
    ${hp}<button class="btn btn-primary" type="submit">Submit event</button><div class="status" role="status"></div></form>`
});

// ---------- About, privacy, 404 ----------
{
  const crumbs = [["Home", "/"], ["About", "/about/"]];
  add("/about/", layout({ title: "About Alpharetta List | Independent Local Guide to Alpharetta, GA", description: "Alpharetta List is an independent, locally focused guide to Alpharetta, Georgia covering restaurants, things to do, events and local businesses.", urlPath: "/about/",
    body: pageHead(crumbs, "About Alpharetta List", "") + `<div class="wrap" style="padding:44px 0"><div class="prose prose-narrow">
    <p class="lede">Alpharetta List is an independent local guide to Alpharetta, Georgia, built for the people who live, work and visit here.</p>
    <p>Alpharetta has one of the best downtowns in metro Atlanta, a nationally known dining and shopping district at Avalon, miles of greenway, a packed events calendar and hundreds of technology companies, but there has never been one place that brings it all together. That is what we are building: honest guides, local news in plain English, an events calendar and a directory of the businesses that make Alpharetta work.</p>
    <h2>Our standards</h2><p>We link to our sources, label any paid content clearly and update our guides when facts change.</p>
    <h2>Get in touch</h2><p>Have a news tip, an event or a correction? <a href="/submit-event/">Send it here</a>. Own a business? <a href="/add-your-business/">Add your listing</a> for free.</p>
    <p>Prefer email? Reach us anytime at <a href="mailto:hello@alpharettalist.com">hello@alpharettalist.com</a></p>
    <p>Alpharetta List is independent and is not affiliated with the City of Alpharetta.</p></div></div>`, jsonld: [crumbsLD(crumbs)] }), "0.4");
}
{
  const crumbs = [["Home", "/"], ["Privacy", "/privacy/"]];
  add("/privacy/", layout({ title: "Privacy Policy | Alpharetta List", description: "How Alpharetta List handles information submitted through our forms and analytics.", urlPath: "/privacy/",
    body: pageHead(crumbs, "Privacy policy", "") + `<div class="wrap" style="padding:44px 0"><div class="prose prose-narrow">
    <p>Last updated ${fmtDate(BUILD_DATE)}. This policy explains what information AlpharettaList.com ("Alpharetta List," "we") collects, how we use it, and your choices. Alpharetta List is an independent local publication and is not affiliated with the City of Alpharetta.</p>
    <h2>Information you give us</h2><p>When you submit a form on this site, such as adding a business or submitting an event, we collect what you enter: for example your name, email address, phone number, business or event details, and any message. We use it to review and publish your listing or event, respond to you, and run the site.</p>
    <h2>How submissions are processed</h2><p>Form submissions are stored privately. To keep the directory accurate and free of spam, business and event submissions may be reviewed automatically using an AI service (Anthropic's Claude), which may check publicly available information on the web. A person may also review any submission. Only approved business and event details are published.</p>
    <h2>What we publish</h2><p>Business and event details you submit for publication (such as name, address, phone, website and description) may appear on the site and in search engines. We never publish the contact email address you give us on a submission form.</p>
    <h2>Analytics and cookies</h2><p>If analytics are enabled, we use Google Analytics to understand how visitors use the site, such as which pages are viewed, how long visits last, the general location (city or region) and the type of device and browser. Google Analytics uses cookies and similar technologies, and Google may process this data under its own privacy policy. We do not use this data to identify you personally. You can block cookies in your browser settings or use the <a href="https://tools.google.com/dlpage/gaoptout" rel="noopener nofollow">Google Analytics opt-out browser add-on</a>. We do not sell your personal information.</p>
    <h2>Links</h2><p>This site links to other websites, including businesses we list. We are not responsible for the privacy practices of other sites.</p>
    <h2>How long we keep information</h2><p>We keep submissions as long as needed to operate the directory and respond to you. You can ask us to update or delete a listing or your submission at any time.</p>
    <h2>Children</h2><p>This site is intended for a general audience and is not directed to children under 13. We do not knowingly collect personal information from children.</p>
    <h2>Your choices and contact</h2><p>To correct or remove a listing, or to ask about the information we hold about you, email <a href="mailto:hello@alpharettalist.com">hello@alpharettalist.com</a> We may update this policy from time to time, and the date at the top shows the latest version.</p></div></div>`, jsonld: [crumbsLD(crumbs)] }), "0.2");
}
write("404.html", layout({ title: "Page not found | Alpharetta List", description: "This page could not be found.", urlPath: "/404.html", noindex: true,
  body: pageHead([["Home", "/"], ["Not found", "/404.html"]], "We couldn't find that page", "Try the directory, the latest news, or head back home.") + `<div class="wrap" style="padding:44px 0;display:flex;gap:12px;flex-wrap:wrap"><a class="btn btn-primary" href="/">Home</a><a class="btn btn-ghost" href="/directory/">Directory</a><a class="btn btn-ghost" href="/blog/">News</a></div>` }));

// ---------- Assets, sitemap, robots, feed ----------
fs.mkdirSync(path.join(OUT, "assets"), { recursive: true });
fs.writeFileSync(path.join(OUT, "assets/site.css"), read("assets/base.css") + read("assets/extra.css") +"\n.foot-h{font-size:14px;color:#fff;margin:0 0 14px;font-weight:600;font-family:var(--sans)}\n.h4{font-family:var(--serif);font-weight:500;font-size:22px;margin:2px 0 0;line-height:1.2}\n");
for (const f of ["main.js", "config.js"]) fs.copyFileSync(path.join(SRC, "assets", f), path.join(OUT, "assets", f));
for (const f of fs.readdirSync(path.join(SRC, "static"))) fs.copyFileSync(path.join(SRC, "static", f), path.join(OUT, f.startsWith("asset-") ? "assets/" + f.slice(6) : f));

if (fs.existsSync(path.join(SRC, "covers"))) { fs.mkdirSync(path.join(OUT, "assets/covers"), { recursive: true }); for (const f of fs.readdirSync(path.join(SRC, "covers"))) fs.copyFileSync(path.join(SRC, "covers", f), path.join(OUT, "assets/covers", f)); }
write("sitemap.xml", `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${pages.map(([u, m, pr]) => `  <url><loc>${SITE}${u}</loc><lastmod>${m}</lastmod><priority>${pr}</priority></url>`).join("\n")}
</urlset>
`);
write("robots.txt", `User-agent: *\nAllow: /\n\nSitemap: ${SITE}/sitemap.xml\n`);
write("feed.xml", `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>Alpharetta List</title><link>${SITE}/</link><description>Local news and guides for Alpharetta, Georgia</description>
${posts.map(p => `<item><title>${esc(p.title)}</title><link>${SITE}/blog/${p.slug}/</link><guid>${SITE}/blog/${p.slug}/</guid><pubDate>${new Date(p.published + "T12:00:00Z").toUTCString()}</pubDate><description>${esc(p.description)}</description></item>`).join("\n")}
</channel></rss>
`);
write("CNAME", "alpharettalist.com\n");
write(".nojekyll", "");
console.log(`Built ${pages.length} pages, ${places.length} places, ${events.length} events, ${posts.length} posts.`);
