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
// Published "Public" tabs of the AlpharettaList Submissions sheet (approved rows only, no contact info).
const SHEET_BASE = "https://docs.google.com/spreadsheets/d/e/2PACX-1vTCrZ2XjkNfZMyCVdLQok6t3q_TNNTJdP9asWh3Z7oZKiE6bOLrrvYHQ4r7t21kz3kdbY4FuoF4_ib3/pub?single=true&output=csv&gid=";
const sheetBiz = await sheet(process.env.SHEET_BUSINESSES_CSV || SHEET_BASE + "1826988435");
const CAT_IDS = ["restaurants", "things-to-do", "parks", "arts", "shopping", "nearby", "home", "health", "realestate", "pets", "kids", "schools", "fitness", "beauty", "services", "coming-soon"];
const catOf = (v) => { const k = String(v || "").toLowerCase().trim(); return CAT_IDS.includes(k) ? k : CAT_MAP[k] || "services"; };
const hoursFromRow = (r) => r.hours || "";
const paras = (t) => String(t || "").split(/\n\s*\n|\r?\n/).map(x => x.trim()).filter(Boolean);
for (const r of sheetBiz) {
  const name = r.business_name || r.name; if (!name) continue;
  const slug = slugify(name);
  if (places.some(p => p.slug === slug)) continue;
  const about = paras(r.description);
  places.push({ slug, name, cat: catOf(r.category), type: r.subcategory || r.category || "Local business", schema: "LocalBusiness",
    address: r.address || "", desc: (about[0] || "").split(/(?<=[.!?])\s/)[0].slice(0, 220), about, website: r.website || "", phone: r.phone || "", hours: hoursFromRow(r), selfListed: true, checked: BUILD_DATE });
}
// Paid Featured listings (from the Featured Public tab): upgrade an existing listing or create a new one.
const sheetFeatured = await sheet(process.env.SHEET_FEATURED_CSV || SHEET_BASE + "589525057");
const PREMIUM_DIR = path.join(SRC, "premium");
for (const r of sheetFeatured) {
  const name = r.business_name; if (!name) continue;
  const fromLink = (String(r.existing_listing || "").match(/\/places\/([a-z0-9-]+)/) || [])[1];
  let p = places.find(x => x.slug === fromLink) || places.find(x => x.slug === slugify(name));
  if (!p) { p = { slug: slugify(name), name, schema: "LocalBusiness" }; places.push(p); }
  const about = paras(r.description);
  Object.assign(p, {
    name, cat: r.category ? catOf(r.category) : p.cat || "services", type: r.subcategory || p.type || "Local business",
    address: r.address || p.address || "", phone: r.phone || p.phone || "", website: r.website || p.website || "", hours: r.hours || p.hours || "",
    ...(about.length ? { about, desc: about[0].split(/(?<=[.!?])\s/)[0].slice(0, 220) } : {}),
    premium: true, deals: r.deals || "", booking: r.booking_url || "", facebook: r.facebook || "", instagram: r.instagram || "",
    mentions: String(r.mention_in || "").split(/\s*,\s*/).filter(Boolean), checked: BUILD_DATE, logo: "", photos: []
  });
  // Photos uploaded through the setup page live in Google Drive; cache them in src/premium/ so they're committed once.
  fs.mkdirSync(PREMIUM_DIR, { recursive: true });
  const grab = async (id) => {
    if (!/^[A-Za-z0-9_-]{10,}$/.test(id)) return "";
    const file = path.join(PREMIUM_DIR, id + ".jpg");
    if (!fs.existsSync(file)) {
      try {
        const res = await fetch(`https://drive.google.com/uc?export=download&id=${id}`);
        const buf = Buffer.from(await res.arrayBuffer());
        if (!res.ok || buf.length < 2000 || !/^image\//.test(res.headers.get("content-type") || "")) throw new Error("not an image");
        fs.writeFileSync(file, buf);
      } catch (e) { console.warn("Featured photo download failed", id, e.message); return ""; }
    }
    return `/assets/premium/${id}.jpg`;
  };
  if (r.logo_id) p.logo = await grab(r.logo_id.trim());
  for (const id of String(r.photo_ids || "").split(",").map(x => x.trim()).filter(Boolean).slice(0, 10)) { const u = await grab(id); if (u) p.photos.push(u); }
}
const sheetEvents = await sheet(process.env.SHEET_EVENTS_CSV || SHEET_BASE + "1094187146");
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
const dateChip = (e, yr) => { const d = new Date(e.start + "T12:00:00"); const mon = d.toLocaleDateString("en-US", { month: "short" }); return `<b>${d.getDate()}</b><small>${mon}${yr ? " " + d.getFullYear() : ""}</small>`; };
const evWhen = (e) => fmtDate(e.start) + (e.end && e.end !== e.start ? " to " + fmtDate(e.end) : "");
const mapsLink = (p) => "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(p.name + " " + (p.address || "Alpharetta, GA"));

// ---------- Shared chrome ----------
const logoSymbol = read("assets/logo-symbol.svg");
const sprite = `<svg width="0" height="0" style="position:absolute" aria-hidden="true">${logoSymbol}</svg>`;
const logo = (light) => `<a class="brand" href="/" aria-label="Alpharetta List home"><span class="logo-tile${light ? " logo-tile-light" : ""}"><svg width="36" height="36" viewBox="0 0 64 64"><use href="#logo"/></svg></span><span class="brand-name">Alpharetta List<span>Alpharetta, Georgia</span></span></a>`;

const NAV = [["/blog/", "News"], ["/directory/", "Directory"], ["/restaurants/", "Eat and Drink"], ["/services/", "Services"], ["/things-to-do/", "Things to Do"], ["/events/", "Events"], ["/advertise/", "Advertise"]];

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
      <div><h2 class="foot-h">Popular guides</h2><ul><li><a href="/blog/best-restaurants-alpharetta-ga/">Best restaurants</a></li><li><a href="/blog/things-to-do-alpharetta-ga/">Things to do</a></li><li><a href="/blog/moving-to-alpharetta-ga-guide/">Moving to Alpharetta</a></li><li><a href="/blog/best-coffee-shops-alpharetta-ga/">Coffee shops</a></li><li><a href="/avalon/">Avalon guide</a></li><li><a href="/halcyon/">Halcyon guide</a></li></ul></div>
      <div><h2 class="foot-h">Work with us</h2><ul><li><a href="/add-your-business/">Add your business</a></li><li><a href="/submit-event/">Submit an event</a></li><li><a href="/advertise/">Advertise</a></li><li><a href="/about/">About</a></li><li><a href="/contact/">Contact</a></li></ul></div>
    </div>
    <div class="legal"><span>&copy; <span id="yr">${new Date().getFullYear()}</span> Alpharetta List. Independent and not affiliated with the City of Alpharetta.</span><span><a href="mailto:hello@alpharettalist.com">hello@alpharettalist.com</a> &nbsp; <a href="/privacy/">Privacy</a> &nbsp; <a href="/terms/">Terms</a> &nbsp; <a href="/contact/">Contact</a> &nbsp; <a href="/about/">About</a></span></div>
  </div>
</footer>`;

const HOME_ICONS = {
  eat: '<path d="M7 3v8a2 2 0 0 0 2 2v8M5 3v5m4-5v5M17 3c-2 2-3 4-3 7h3v11"/>', fun: '<path d="M12 3l2.6 5.6 6 .8-4.4 4.2 1.1 6-5.3-3-5.3 3 1.1-6L3.4 9.4l6-.8z"/>',
  park: '<path d="M12 3l5 7h-3l4 6H6l4-6H7zM12 16v5"/>', shop: '<path d="M5 8h14l-1 12H6zM9 8V6a3 3 0 0 1 6 0v2"/>', home: '<path d="M4 11l8-7 8 7v9h-5v-6H9v6H4z"/>',
  health: '<path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.5-7 10-7 10z"/>', beauty: '<path d="M12 3c2 3 4 5 4 8a4 4 0 0 1-8 0c0-3 2-5 4-8zM8 20h8"/>',
  more: '<circle cx="6" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="18" cy="12" r="1.5"/>', cal: '<path d="M5 6h14v14H5zM5 10h14M9 4v4m6-4v4"/>',
  pin: '<path d="M12 21s-6-6-6-11a6 6 0 0 1 12 0c0 5-6 11-6 11z"/><circle cx="12" cy="10" r="2"/>', srch: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/>'
};
const tabbar = (urlPath) => { const ic = (k) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${HOME_ICONS[k]}</svg>`; const t = [["/", "home", "Home"], ["/restaurants/", "eat", "Eat"], ["/events/", "cal", "Events"], ["/areas/", "pin", "Areas"], ["/directory/", "srch", "Search"]]; return `<nav class="tabbar" aria-label="Quick links">${t.map(x => `<a href="${x[0]}"${(x[0] === "/" ? urlPath === "/" : urlPath.startsWith(x[0])) ? ' class="on" aria-current="page"' : ""}>${ic(x[1])}${x[2]}</a>`).join("")}</nav>`; };

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
  <form class="hsearch" role="search" action="/directory/" method="get"><label><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/></svg><span class="sr">Search Alpharetta</span><input name="q" type="search" placeholder="Search Alpharetta..." autocomplete="off"></label></form>
  <nav class="main" id="mainnav" aria-label="Main">${NAV.map(([h, l]) => `<a href="${h}"${h === "/advertise/" ? ' class="nav-ad"' : ""}${urlPath.startsWith(h) ? ' aria-current="page"' : ""}>${l}</a>`).join("")}</nav>
  <a class="btn btn-primary header-cta" href="/add-your-business/">Add your business</a>
  <button class="menu-toggle" aria-expanded="false" aria-controls="mainnav">Menu</button>
</div></header>
${sponsors ? sponsorBar + "\n" + sponsorRails : ""}
<main id="main">
${body}
</main>
${sponsors ? sponsorShowcase : ""}
${footer}
${tabbar(urlPath)}
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

// Area (neighborhood) pages: every area with 3+ listings gets /areas/<slug>/; Avalon and Halcyon go to their full guides.
const areaName = (a) => String(a || "").replace(/^nearby - /i, "").replace(/ \(nearby\)$/i, "").trim();
const AREA_COUNTS = {}; places.forEach(p => { const a = areaName(p.area); if (a) AREA_COUNTS[a] = (AREA_COUNTS[a] || 0) + 1; });
const areaUrl = (a) => { const n = areaName(a); if (!n) return ""; if (n === "Avalon") return "/avalon/"; if (n === "Halcyon") return "/halcyon/"; return AREA_COUNTS[n] >= 3 ? `/areas/${slugify(n)}/` : ""; };
const areaLink = (a, fallback = "Alpharetta") => { const u = areaUrl(a); const label = esc(a || fallback); return u ? `<a class="area-link" href="${u}">${label}</a>` : label; };
const listingCard = (p) => `
<article class="listing${p.sponsored ? " sponsored" : ""}${p.premium ? " premium" : ""}" data-cat="${p.cat}" data-search="${esc((p.name + " " + p.type + " " + (p.cuisine || "") + " " + p.desc + " " + (p.area || "") + " " + catLabel(p.cat)).toLowerCase())}">
  <div class="listing-top"><span>${esc(p.type)}</span>${p.premium ? '<span class="pill feat">Featured</span>' : p.sponsored ? '<span class="pill spons">Sponsored</span>' : p.verified ? '<span class="pill ver">Verified</span>' : ""}</div>${p.premium && p.photos && p.photos[0] ? `<img class="listing-photo" src="${p.photos[0]}" alt="${esc(p.name)}" loading="lazy">` : ""}
  <h3 class="h4"><a href="/places/${p.slug}/">${esc(p.name)}</a></h3>
  <p>${esc(p.desc)}</p>
  <div class="meta"><span>${areaLink(p.area)}</span><a href="/places/${p.slug}/">Details</a></div>
</article>`;

const postCard = (p) => `
<article class="post-card">
  <a class="thumb" href="/blog/${p.slug}/" aria-label="${esc(p.h1)}">${coverImg(p) || '<svg viewBox="0 0 64 64" aria-hidden="true"><use href="#logo"/></svg>'}</a>
  <div class="pad"><div class="tag">${esc(p.category)}</div><h3><a href="/blog/${p.slug}/">${esc(p.h1)}</a></h3><p>${esc(p.description)}</p><div class="byline">${fmtDate(p.published)} &middot; ${p.readMins} min read</div></div>
</article>`;

const coverFile = (p) => fs.existsSync(path.join(SRC, "covers", p.slug + ".jpg")) ? `/assets/covers/${p.slug}.jpg` : "";
const coverImg = (p, eager) => coverFile(p) ? `<img src="${coverFile(p)}" alt="${esc(p.coverAlt || p.h1)}" ${eager ? 'fetchpriority="high"' : 'loading="lazy"'} width="1600" height="900">` : "";
const pages = []; // for sitemap: [path, lastmod, priority]
const EXTRA_KEEP = []; // built pages kept out of the sitemap (noindex)
const add = (urlPath, html, priority = "0.7", lastmod = BUILD_DATE) => { write(urlPath === "/" ? "index.html" : urlPath.replace(/^\//, "") + "index.html", html); pages.push([urlPath, lastmod, priority]); };

// ---------- Home ----------
{
  const featured = places.filter(p => p.featured).slice(0, 9);
  const counts = Object.fromEntries(CATS.map(c => [c.id, places.filter(p => p.cat === c.id).length]));
  const lead = posts[0], minis = posts.slice(1, 3), rest = posts.slice(3, 9);
  const hi = (k) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${HOME_ICONS[k]}</svg>`;
  const cv = (slug) => fs.existsSync(path.join(SRC, "covers", slug + ".jpg")) ? `/assets/covers/${slug}.jpg` : "";
  const heroImg = ["home-hero", "best-restaurants-downtown-alpharetta-ga"].map(cv).find(Boolean) || ""; // home-hero.jpg: Alpharetta City Hall, softened
  const homeCats = [["eat", "Restaurants", "restaurants"], ["fun", "Things to do", "things-to-do"], ["park", "Parks and trails", "parks"], ["shop", "Shopping", "shopping"], ["home", "Home services", "home"], ["health", "Health", "health"], ["beauty", "Beauty and spas", "beauty"]].filter(c => counts[c[2]]);
  const homeAreas = [["Avalon", "/avalon/", "avalon-on-ice-skating-alpharetta-2026", "Shops, dining, ice rink"], ["Downtown Alpharetta", "/areas/downtown-alpharetta/", "best-restaurants-downtown-alpharetta-ga", "City Center and Town Green"], ["Halcyon", "/halcyon/", "halcyon-alpharetta-guide-restaurants-shops-things-to-do", "Dining and the Greenway"], ["Big Creek Greenway", "/places/big-creek-greenway/", "big-creek-greenway-alpharetta-guide", "Trails and parks"]];
  const paid = places.filter(p => p.premium);
  const newest = [...posts].sort((x, y) => y.published.localeCompare(x.published));
  const withCover = newest.filter(p => coverFile(p));
  const hLead = withCover[0], hSide = withCover.slice(1, 5), hMore = newest.filter(p => p !== hLead && !hSide.includes(p)).slice(0, 6);
  const season = ["christmas-holiday-events-alpharetta-ga-2026", "christmas-lights-near-alpharetta-ga-2026", "christmas-with-kids-alpharetta-ga-2026", "black-friday-2026-hours-alpharetta-avalon-north-point-halcyon"].map(sl => posts.find(p => p.slug === sl)).filter(Boolean);
  const evCard = (e) => { const d = new Date(e.start + "T12:00:00"); return `<a class="m-ev" href="/events/#${e.slug}"><div class="ph">${e.image ? `<img src="${e.image}" alt="" loading="lazy" width="400" height="300">` : ""}<div class="d"><i>${d.toLocaleDateString("en-US", { month: "short" })}</i><b>${d.getDate()}</b></div></div><div class="tx"><strong>${esc(e.title)}</strong><small>${hi("pin")}${esc(e.venue || "Alpharetta")}</small></div></a>`; };
  const body = `
<section class="m-hero"${heroImg ? ` style="background-image:url(${heroImg})"` : ""}><div class="wrap"><div class="m-kicker">Alpharetta, Georgia</div>
  <h1>Find the best of Alpharetta</h1>
  <p>${places.length}+ restaurants, shops and local businesses across Alpharetta, GA, plus what's happening this week.</p>
  <form class="m-search" role="search" action="/directory/" method="get"><label>${hi("srch")}<span class="sr">Search</span><input name="q" type="search" placeholder="Search sushi, plumbers, parks..."></label><button type="submit">Search</button></form>
  <div class="m-chips"><a class="hot" href="/events/">This weekend</a><a href="/restaurants/">Restaurants</a>${season.length ? `<a href="/blog/${season[0].slug}/">Holiday events</a>` : ""}<a href="/avalon/">Avalon</a><a href="/halcyon/">Halcyon</a><a href="/things-to-do/">Things to do</a><a href="/services/">Home services</a></div>
</div></section>

${events.length ? `<section class="m-sec" id="events"><div class="wrap"><div class="m-head"><h2>Happening this week</h2><a href="/events/">All events</a></div><div class="m-row">${events.slice(0, 4).map(evCard).join("")}</div></div></section>` : ""}

<section class="m-sec" id="directory"><div class="wrap"><div class="m-head"><h2>Browse the directory</h2><a href="/directory/">See all ${places.length}</a></div>
  <div class="m-cats">${homeCats.map(c => `<a class="m-cat" href="/directory/?cat=${c[2]}"><i>${hi(c[0])}</i><strong>${c[1]}</strong><span>${counts[c[2]]} places</span></a>`).join("")}<a class="m-cat" href="/directory/"><i>${hi("more")}</i><strong>All categories</strong><span>${places.length} places</span></a></div>
</div></section>

<section class="m-sec" id="areas"><div class="wrap"><div class="m-head"><h2>Explore by area</h2><a href="/areas/">All areas</a></div>
  <div class="m-areas">${homeAreas.map((a, n) => `<a class="m-ar${n ? "" : " big"}" href="${a[1]}">${cv(a[2]) ? `<img src="${cv(a[2])}" alt="" loading="lazy" width="800" height="450">` : ""}<div><strong>${a[0]}</strong><span>${a[3]}</span></div></a>`).join("")}<a class="m-ar all" href="/areas/"><div><strong>Windward, North Point, Crabapple and more</strong></div></a></div>
</div></section>

<section class="m-sec alt"><div class="wrap"><div class="m-head"><h2>Featured local businesses</h2><a href="/add-your-business/">Get Featured</a></div>
  <div class="m-row">${paid.slice(0, 4).map(p => `<a class="m-fc" href="/places/${p.slug}/"><span class="bd">Featured</span><strong>${esc(p.name)}</strong><span>${esc(p.type)} &middot; ${esc(p.area || "Alpharetta")}</span></a>`).join("")}${Array.from({ length: Math.max(0, 4 - paid.length) }, () => `<a class="m-fc you" href="/add-your-business/"><span class="bd">Open spot</span><strong>Your business here</strong><span>Top of your category, with photos.</span><em>$19/month</em></a>`).join("")}</div>
</div></section>

<section class="m-sec" id="news"><div class="wrap"><div class="m-head"><h2>Latest from Alpharetta</h2><a href="/blog/">All news and guides</a></div>
  <div class="m-news"><a class="m-ld" href="/blog/${hLead.slug}/"><div class="ph">${coverImg(hLead, false)}</div><div class="tg">${esc(hLead.category)}</div><h3>${esc(hLead.h1)}</h3><p>${esc(hLead.description)}</p></a>
  <div class="m-sd">${hSide.map(p => `<a href="/blog/${p.slug}/"><div class="ph">${coverImg(p)}</div><div><div class="tg">${esc(p.category)}</div><h4>${esc(p.h1)}</h4></div></a>`).join("")}</div></div>
  <ul class="m-more">${hMore.map(p => `<li><a href="/blog/${p.slug}/">${esc(p.h1)}</a><span>${fmtDate(p.published)}</span></li>`).join("")}</ul>
  ${season.length > 1 ? `<div class="m-season"><div><div class="m-kicker">Holiday guide 2026</div><h2>Christmas in Alpharetta</h2><p>Tree lightings, ice skating, lights and what's open, all in one place.</p></div><ul>${season.map(p => `<li><a href="/blog/${p.slug}/">${esc(p.h1.split(":")[0])}</a></li>`).join("")}</ul></div>` : ""}
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

// Return the hours for one day ("closed", "11am-9pm") from a string like "Mon-Thu 11am-9pm; Fri-Sat 11am-10pm; Sun closed", or null.
const DAY_AB = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const dayHours = (hours, day) => {
  if (!hours || !/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun|Daily)/.test(hours) || /lunch|dinner|brunch|kitchen|bar |season|varies|appoint/i.test(hours)) return null;
  const di = DAY_AB.indexOf(day);
  for (const seg of hours.split(/;\s*|,\s*(?=(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b)/)) {
    const m = seg.match(/^(Daily|Mon|Tue|Wed|Thu|Fri|Sat|Sun)(?:-(Mon|Tue|Wed|Thu|Fri|Sat|Sun))?(?:,\s*(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun))*\s+(.+)$/);
    if (!m) continue;
    const val = m[3].trim().replace(/\.$/, "");
    if (m[1] === "Daily") return val;
    const a = DAY_AB.indexOf(m[1]), b = m[2] ? DAY_AB.indexOf(m[2]) : a;
    const inRange = a <= b ? di >= a && di <= b : di >= a || di <= b;
    if (inRange && !/,/.test(seg.slice(0, seg.indexOf(" ")))) return /closed/i.test(val) ? "closed" : val;
  }
  return null;
};
// Day-by-day hours table and quick facts derived from the hours string.
const DAY_FULL = { Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday", Fri: "Friday", Sat: "Saturday", Sun: "Sunday" };
const weekHours = (hours) => { const rows = DAY_AB.map(d => [d, dayHours(hours, d)]); return rows.filter(r => r[1]).length >= 5 ? rows : null; };
const toMin = (t) => { const m = String(t).trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i); if (!m) return null; let h = +m[1] % 12 + (m[3].toLowerCase() === "pm" ? 12 : 0); return h * 60 + (+m[2] || 0); };
const hoursFacts = (rows) => {
  if (!rows) return null;
  let late = [], early = [], closed = [];
  for (const [d, v] of rows) {
    if (!v) continue;
    if (v === "closed") { closed.push(d); continue; }
    for (const rng of v.split(",")) {
      const [a, b] = rng.split("-").map(x => x && x.trim());
      const s = toMin(a), e = toMin(b);
      if (s != null && s <= 7 * 60 + 30) early.push(d);
      if (e != null && (e >= 21 * 60 + 30 || e <= 4 * 60)) late.push(d);
    }
  }
  return { late: [...new Set(late)], early: [...new Set(early)], closed };
};
const dayList = (ds) => ds.length === 7 ? "every day" : ds.map(d => DAY_FULL[d]).join(", ").replace(/, ([^,]*)$/, " and $1");
// Data summary and comparison table for directory-style pages.
function listDataBlock(list, h1) {
  if (list.length < 3 || list.length > 160) return "";
  const withHours = list.filter(p => weekHours(p.hours));
  const facts = withHours.map(p => hoursFacts(weekHours(p.hours)));
  const sunOpen = withHours.filter(p => { const v = dayHours(p.hours, "Sun"); return v && v !== "closed"; }).length;
  const late = facts.filter(f => f.late.length).length, early = facts.filter(f => f.early.length).length;
  const areas = {}; list.forEach(p => { const a = (p.area || "Alpharetta").replace(" (nearby)", ""); areas[a] = (areas[a] || 0) + 1; });
  const topAreas = Object.entries(areas).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const checked = list.map(p => p.checked).filter(Boolean).sort().pop();
  const stat = (n, label) => `<div class="data-stat"><b>${n}</b><span>${label}</span></div>`;
  const subject = h1.replace(/^(The best |Best |The )/i, "").replace(/ in Alpharetta, GA$/i, "");
  return `<section class="data-block">
    <h2>${esc(subject)} by the numbers</h2>
    <div class="data-stats">${stat(list.length, "listed")}${stat(list.filter(p => p.phone).length, "with a phone number")}${withHours.length ? stat(withHours.length, "with day-by-day hours") : ""}${sunOpen ? stat(sunOpen, "open on Sundays") : ""}${late ? stat(late, "open 9:30pm or later") : ""}${early ? stat(early, "open by 7:30am") : ""}</div>
    ${topAreas.length > 1 ? `<p class="data-note"><strong>Where they are:</strong> ${topAreas.map(([a, n]) => `${esc(a)} (${n})`).join(", ")}.</p>` : ""}
    <h3>Compare at a glance</h3>
    <div class="table-wrap"><table class="compare-table"><thead><tr><th>Name</th><th>Type</th><th>Area</th><th>Sunday</th><th>Phone</th></tr></thead><tbody>${list.map(p => { const v = dayHours(p.hours, "Sun"); return `<tr><td><a href="/places/${p.slug}/">${esc(p.name)}</a></td><td>${esc(p.type)}</td><td>${esc((p.area || "Alpharetta").replace(" (nearby)", ""))}</td><td>${v ? (v === "closed" ? "Closed" : esc(v)) : "&ndash;"}</td><td>${p.phone ? esc(p.phone) : "&ndash;"}</td></tr>`; }).join("")}</tbody></table></div>
    <p class="data-note">Sunday hours are shown where a business lists regular day-by-day hours; a dash means hours vary or are by appointment. ${checked ? `Details last checked ${new Date(checked + "T12:00:00Z").toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" })}.` : ""} Spot an error? Email <a href="mailto:hello@alpharettalist.com">hello@alpharettalist.com</a></p>
  </section>`;
}
// ---------- Directory (all) ----------
function directoryPage({ urlPath, crumbs, h1, sub, title, description, list, showFilters = true, intro = "" }) {
  list = [...list.filter(p => p.premium), ...list.filter(p => !p.premium)];
  const cats = CATS.filter(c => list.some(p => p.cat === c.id));
  const heroExtra = showFilters ? `<div class="search page-search"><label for="dir-q" style="flex:1;display:flex"><span class="sr">Search the directory</span><input id="dir-q" type="search" placeholder="Search by name, cuisine or type"></label><span class="page-search-ico" aria-hidden="true"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg></span></div>
  <div class="head-stats"><span><b>${list.length}</b> places</span>${cats.length > 1 ? `<span><b>${cats.length}</b> categories</span>` : ""}<span>Free to list</span></div>` : "";
  const body = pageHead(crumbs, h1, sub, heroExtra) + `<div class="wrap">${sponsor()}</div>
<section class="wrap dir-body">
  ${intro}
  ${showFilters && cats.length > 1 ? `<div class="dir-tools">
  <div class="filters" role="group" aria-label="Filter by category"><button aria-pressed="true" data-f="all">All</button>${cats.map(c => `<button aria-pressed="false" data-f="${c.id}">${c.label}</button>`).join("")}</div></div>` : ""}${showFilters ? `
  <p class="count-note" id="count-note" role="status">${list.length} places</p>` : ""}
  <div class="listings" data-filter-grid>${list.map(listingCard).join("")}</div>
  ${listDataBlock(list, h1)}
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
  title: "Alpharetta Restaurants: Best Places to Eat in Alpharetta, GA (2026)",
  description: `${places.filter(p => p.cat === "restaurants").length} Alpharetta restaurants with hours, phone numbers and websites: downtown, Avalon, Windward and Halcyon picks, from steakhouses and sushi to brunch and BBQ.`,
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


// Senior living comparison table for /services/senior-living/ (built from places with a care list).
function seniorGuide() {
  const H = (t) => `<h2 style="font-family:var(--serif);font-weight:500;font-size:24px;margin:22px 0 8px">${t}</h2>`;
  const list = places.filter(p => p.care).sort((a, b) => (b.premium ? 1 : 0) - (a.premium ? 1 : 0) || a.name.localeCompare(b.name));
  const has = (p, k) => p.care.some(c => c.toLowerCase().startsWith(k)) ? '<span aria-label="yes">&#10003;</span>' : '<span aria-label="no" style="color:var(--muted)">&ndash;</span>';
  const rows = list.map(p => `<tr><td><a href="/places/${p.slug}/">${esc(p.name)}</a></td><td>${has(p, "55+")}</td><td>${has(p, "independent")}</td><td>${has(p, "assisted")}</td><td>${has(p, "memory")}</td><td>${p.area ? esc(areaName(p.area)) : "Alpharetta"}</td><td style="white-space:nowrap">${esc(p.phone || "")}</td></tr>`).join("");
  return H("Alpharetta senior living at a glance") + `<p>Every senior community we list in and around Alpharetta, side by side. Tap a name for hours, amenities, pricing notes and directions.</p><div class="table-wrap"><table class="compare-table"><thead><tr><th>Community</th><th>55+ rentals</th><th>Independent</th><th>Assisted</th><th>Memory care</th><th>Area</th><th>Phone</th></tr></thead><tbody>${rows}</tbody></table></div>`
    + H("The four types of senior living, explained") + `<ul><li><strong>55+ active adult rentals</strong> are regular apartments or homes for people 55 and older, with a clubhouse, pool, events and neighbors at the same stage of life. There is no care or meal plan. In Alpharetta they generally rent for about $1,800 to $3,800 a month.</li><li><strong>Independent living</strong> adds services: meals, housekeeping, transportation and a full activity calendar, but no hands-on care.</li><li><strong>Assisted living</strong> adds daily help with things like bathing, dressing and medications, with staff on site around the clock. A Place for Mom puts the average in Alpharetta at about $4,745 a month.</li><li><strong>Memory care</strong> is a secured neighborhood with specially trained staff for people living with Alzheimer's disease or other dementia. It usually costs more than assisted living.</li></ul><p>Many communities also offer <strong>respite stays</strong>, short stays of a few days to a few weeks after a hospital visit or while a family caregiver takes a break. Read our full <a href="/blog/senior-living-alpharetta-ga-guide/">guide to senior living in Alpharetta</a> for costs, questions to ask and how to pay.</p>`;
}

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
  { slug: "hair-salons", noun: "Hair Salons", re: /hair salon|blowout|salon(?! ?& ?spa suites)/i, cats: ["beauty"], blurb: "haircuts, color, highlights, extensions and blowouts", tips: ["Book color appointments a week or two ahead, especially before holidays", "Ask for a consultation before a big color change", "Check whether the salon charges by stylist level"] },
  { slug: "barbershops", noun: "Barbershops", re: /barber/i, cats: ["beauty"], blurb: "men's and kids' haircuts, fades, beard trims and hot towel shaves", tips: ["Many barbers take online bookings, which beats waiting for a walk-in chair", "Saturday mornings are the busiest time", "Bring a photo of the cut you want"] },
  { slug: "dermatologists", noun: "Dermatologists", re: /dermatolog/i, cats: ["health"], blurb: "medical, surgical and cosmetic dermatology, skin checks and acne care", tips: ["New-patient appointments can book out weeks ahead, so call early", "Confirm the practice is in network with your insurance", "Ask whether you'll see a dermatologist or a physician assistant"] },
  { slug: "eye-doctors", noun: "Eye Doctors", re: /eye doctor|optomet|ophthalm|eye care|vision/i, cats: ["health"], blurb: "eye exams, contact lens fittings, glasses and eye care", tips: ["Vision plans and medical insurance cover different things, so ask which applies", "Bring your current glasses and contact lens boxes to your exam", "Ask whether dilation is included so you can plan a ride"] },
  { slug: "primary-care", noun: "Primary Care Doctors", re: /primary care|internal medicine|family medicine|concierge/i, cats: ["health"], blurb: "family medicine, internal medicine, annual physicals and sick visits", tips: ["Ask whether the practice is accepting new patients before you book", "Check which hospital system the practice belongs to", "Many practices offer same-day sick visits if you call early"] },
  { slug: "movers", noun: "Moving Companies", re: /mover|moving/i, cats: ["home", "services"], blurb: "local and long-distance moving, packing and storage", tips: ["Get at least three in-home or video estimates", "Book four to six weeks ahead for summer and end-of-month moves", "Ask whether the quote is binding or an estimate"] },
  { slug: "house-cleaning", noun: "House Cleaning Services", re: /house cleaning|maid|cleaning service/i, cats: ["home", "services"], blurb: "recurring house cleaning, deep cleans and move-in or move-out cleaning", tips: ["Ask whether cleaners are employees or contractors, and whether they're insured and bonded", "Schedule a deep clean first, then switch to recurring service", "Clarify what's included, such as inside the oven or fridge"] },
  { slug: "painters", noun: "House Painters", re: /painter|painting/i, cats: ["home"], blurb: "interior and exterior house painting, cabinets and drywall repair", tips: ["Exterior painting is best scheduled for spring or fall", "Get a written quote that lists prep work, coats and paint brand", "Check your HOA's approved color list before picking exterior colors"] },
  { slug: "garage-door", noun: "Garage Door Companies", re: /garage door/i, cats: ["home"], blurb: "garage door repair, spring replacement, openers and new doors", tips: ["Never try to replace torsion springs yourself", "Ask for the total price, including parts and the service call", "Ask about the warranty on parts and labor"] },
  { slug: "handymen", noun: "Handyman Services", re: /handyman/i, cats: ["home"], blurb: "home repairs, small projects, carpentry and odd jobs", tips: ["Bundle small jobs into one visit to save on trip charges", "Larger electrical, plumbing or HVAC work needs a licensed trade", "Ask whether they charge hourly or by the job"] },
  { slug: "auto-body", noun: "Auto Body Shops", re: /auto body|collision/i, cats: ["services"], blurb: "collision repair, dent repair, paint and insurance claims", tips: ["In Georgia you can choose your own body shop, even if your insurer recommends one", "Ask whether the shop uses OEM or aftermarket parts", "Ask about the warranty on paint and repairs"] },
  { slug: "insurance-agents", noun: "Insurance Agents", re: /insurance/i, cats: ["services"], blurb: "auto, home, life and business insurance from local agents", tips: ["Bundling home and auto often lowers premiums, so ask for both quotes", "Independent agents can compare several carriers", "Review your coverage every year, especially after a move or a new driver"] },
  { slug: "tutoring", noun: "Tutoring Centers", re: /tutor|learning center|test prep/i, cats: ["kids", "schools"], blurb: "tutoring, test prep, math and reading help for students", tips: ["Ask for an initial assessment so lessons target real gaps", "Start SAT and ACT prep a few months before test day", "Ask how progress is reported to parents"] },
  { slug: "martial-arts", noun: "Martial Arts Schools", re: /martial|karate|taekwondo|jiu|krav|mma|kung fu|judo/i, cats: ["fitness", "kids"], blurb: "karate, taekwondo, jiu-jitsu and martial arts classes for kids and adults", tips: ["Most schools offer a free or low-cost trial class", "Ask about contract length before signing up", "Watch a class at your child's level before enrolling"] },
  { slug: "dance-studios", noun: "Dance Studios", re: /dance/i, cats: ["kids", "fitness", "arts"], blurb: "ballet, jazz, hip hop and competitive dance classes", tips: ["Ask whether the studio is recreational, competitive or both", "Recital costumes and fees are often extra, so ask up front", "Fall registration usually opens in summer"] },
  { slug: "hotels", noun: "Hotels", re: /hotel|inn\b|suites/i, cats: ["things-to-do"], blurb: "hotels near Avalon, downtown and the Windward and North Point business districts", tips: ["Weekday rates near the office parks can be higher than weekends", "Ask whether parking is free or valet only", "Book early for big Ameris Bank Amphitheatre concert weekends"] },
  { slug: "dog-grooming", noun: "Dog Groomers and Pet Boarding", re: /groom|boarding|pet resort|doggy|dog daycare|camp bow wow/i, cats: ["pets"], blurb: "dog grooming, boarding, daycare and self-serve dog washes", tips: ["Most groomers and boarders require proof of rabies and other vaccines", "Book holiday boarding well ahead, since it fills fast", "Ask whether a trial day is required before boarding"] },
  { slug: "senior-living", noun: "Senior Living Communities", re: /senior living|assisted living|memory care|retirement|55\+|active adult/i, cats: ["health"], blurb: "55+ active adult apartments, independent living, assisted living and memory care communities", guide: seniorGuide(), tips: ["Visit at mealtime to get a feel for daily life", "Ask what is included in the monthly fee and what costs extra", "Check the community's state license and inspection history", "For 55+ rentals, ask which monthly fees are added on top of base rent", "Tour at least three communities before you decide"] },
  { slug: "wedding-venues", noun: "Wedding and Event Venues", re: /event venue|wedding/i, cats: ["services"], blurb: "wedding, reception and private event venues", tips: ["Popular spring and fall dates book a year or more ahead", "Ask whether the venue requires its own caterer or allows outside vendors", "Ask about a rain plan for outdoor ceremonies"] },
  { slug: "preschools", noun: "Preschools and Daycares", re: /preschool|montessori|goddard|kindercare|academy alpharetta/i, cats: ["schools", "kids"], blurb: "preschool, pre-K, Montessori and early learning programs", tips: ["Tour at drop-off or pickup time to see the real routine", "Ask about teacher ratios, turnover and curriculum approach", "Waitlists are common, so start looking six months or more ahead"] }
];
const SERVICE_GUIDES = JSON.parse(fs.readFileSync(path.join(SRC, "data/service-guides.json"), "utf8"));
const SVC_CATS = ["home", "health", "pets", "realestate", "fitness", "beauty", "services", "kids", "schools"];
const servicePagesBuilt = [];
for (const sp of SERVICE_PAGES) {
  const list = places.filter(p => (sp.cats || SVC_CATS).includes(p.cat) && sp.re.test(p.type + " " + p.name));
  if (list.length < 2) continue;
  servicePagesBuilt.push({ ...sp, count: list.length });
  const url = `/services/${sp.slug}/`;
  const faqs = [
    { q: `How do I find the best ${sp.noun.toLowerCase()} in Alpharetta, GA?`, a: `Start with providers based in or regularly serving Alpharetta, check licensing and reviews, and get more than one quote for bigger jobs. This page lists ${list.length} options for ${sp.blurb}.` },
    ...(sp.faqs || []), ...((SERVICE_GUIDES[sp.slug] || {}).faqs || []).map(f => ({ q: esc(f.q), a: esc(f.a) })),
    { q: `Do these ${sp.noun.toLowerCase()} serve all of Alpharetta?`, a: `Most serve all Alpharetta ZIP codes, including 30004, 30005, 30009 and 30022, plus nearby Milton, Roswell and Johns Creek. Call to confirm they cover your address.` }
  ];
  const intro = listIntro(`<p>Looking for the best ${sp.noun.toLowerCase()} in Alpharetta, Georgia? Here are ${list.length} local providers for ${sp.blurb} in and around Alpharetta, with addresses and phone numbers where available.</p>${sp.guide || ""}${SERVICE_GUIDES[sp.slug] && SERVICE_GUIDES[sp.slug].paras ? `<h2 style="font-family:var(--serif);font-weight:500;font-size:24px;margin:22px 0 8px">${esc(SERVICE_GUIDES[sp.slug].heading)}</h2>${SERVICE_GUIDES[sp.slug].paras.map(t => `<p>${esc(t)}</p>`).join("")}` : ""}<h2 style="font-family:var(--serif);font-weight:500;font-size:24px;margin:22px 0 8px">Tips for hiring ${sp.noun.toLowerCase()} in Alpharetta</h2><ul>${sp.tips.map(t => `<li>${t}</li>`).join("")}</ul><p>Own one of these businesses? <a href="/add-your-business/">Claim or add your listing</a> for free.</p>`)
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
  "Halcyon (nearby)": "at Halcyon, the walkable shopping and dining district at GA 400 exit 12, just north of Alpharetta",
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
// Links from listings to the Avalon and Halcyon neighborhood guides.
const districtOf = (p) => p.slug === "avalon" || p.area === "Avalon" ? "avalon" : p.slug === "halcyon" || p.area === "Halcyon (nearby)" ? "halcyon" : "";
const districtLinks = (p) => {
  const k = districtOf(p); if (!k || !DISTRICTS_LITE[k]) return "";
  const d = DISTRICTS_LITE[k];
  const pick = p.cat === "restaurants" ? ["restaurants", "parking"] : p.cat === "shopping" ? ["shopping", "parking"] : ["things-to-do", "parking"];
  return `<p><strong>Planning a visit?</strong> See our <a href="/${k}/">complete ${d} guide</a>, including ${pick.map(s => `<a href="/${k}/${s}/">${s === "parking" ? "parking and hours" : s.replace(/-/g, " ")}</a>`).join(" and ")}.</p>`;
};
const DISTRICTS_LITE = { avalon: "Avalon", halcyon: "Halcyon" };
const AREA_GUIDE = {
  "Halcyon (nearby)": "Halcyon is a 135-acre walkable district at GA 400 exit 12, just over the line in south Forsyth County with an Alpharetta mailing address. Parking is free in the six-level deck, public and family restrooms are in the Market Hall across from the Village Green, and a trail extension near Halcyon Way and Ronald Reagan Parkway connects to the Big Creek Greenway.",
  "Downtown Alpharetta": "Downtown is built for walking. City Center, with the Town Green, City Hall and the library, sits a block off Main Street, and free public parking decks are spread around the district, so most people park once and walk. Canton Street and Milton Avenue are lined with restaurants and shops, the Town Green hosts concerts and festivals, and the paved Alpha Loop links downtown to Avalon. On Saturday mornings from spring through fall, the <a href=\"/places/alpharetta-farmers-market/\">Alpharetta Farmers Market</a> sets up on Old Canton Street.",
  "Avalon": "Avalon is an 86-acre walkable district off Old Milton Parkway with restaurants, shops, a movie theater, a hotel and a central plaza. Parking is in decks throughout the property, and on busy weekend evenings it pays to arrive a little early. The plaza hosts seasonal events, including an ice rink in winter, and the Alpha Loop connects Avalon with Downtown Alpharetta about a mile away.",
  "Windward": "The Windward area wraps around Windward Parkway and GA 400 exit 11 on Alpharetta's north side. It mixes office campuses with shopping centers and restaurants along Windward Parkway, and it's an easy hop to Halcyon and Forsyth County to the north. Most businesses here have their own surface parking.",
  "North Point": "The North Point area runs along North Point Parkway near GA 400, anchored by North Point Mall and lined with shopping centers, restaurants and medical offices. The Big Creek Greenway trail runs nearby, and Ameris Bank Amphitheatre is a short drive west. Expect easy parking but busy traffic around the mall and GA 400 interchanges at rush hour.",
  "Old Milton Pkwy": "Old Milton Parkway is the east-west corridor that ties GA 400 to Avalon and downtown. It's lined with shopping centers, restaurants and offices, and most stops have their own parking lots. Traffic is heaviest at rush hour near the GA 400 interchange.",
  "North Main St": "North Main Street (Highway 9) runs north from Downtown Alpharetta toward Milton. Businesses here mostly sit in shopping centers with their own parking, a quick drive from the restaurants and shops of downtown.",
  "Crabapple": "Crabapple sits on Alpharetta's west side near the Milton line, known for its rolling, horse-country feel, larger lots and the historic Crabapple crossroads just over the line in Milton. Most businesses here are in small shopping centers with easy parking.",
  "Haynes Bridge": "Haynes Bridge Road crosses GA 400 in south Alpharetta, close to the Big Creek Greenway and Old Milton Parkway. Businesses here are mostly in shopping centers and office parks with their own parking.",
  "McGinnis Ferry": "McGinnis Ferry Road runs along Alpharetta's northeast edge near the Johns Creek and Forsyth County lines. It's a busy commuter route with shopping centers, medical offices and neighborhoods on both sides."
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
    ...(p.phone ? [{ q: `What is the phone number for ${p.name}?`, a: `You can reach ${p.name} at ${p.phone}.` }] : []),
    ...((() => { const s = dayHours(p.hours, "Sun"); if (!s || /\b(open|now)\b/i.test(p.name)) return []; return [{ q: `Is ${p.name} open on Sunday?`, a: s === "closed" ? `No. ${p.name} is closed on Sundays.` : `Yes. ${p.name} is open on Sundays, ${s}.` }]; })()),
    ...(p.extraFaq || [])
  ];
  const ldPlace = {
    "@context": "https://schema.org", "@type": p.schema || "LocalBusiness", name: p.name, description: p.about && p.about.length ? p.about.join(" ") : p.desc, url: `${SITE}/places/${p.slug}/`,
    ...(addrParts ? { address: { "@type": "PostalAddress", streetAddress: addrParts[1], addressLocality: addrParts[2], addressRegion: "GA", postalCode: addrParts[3], addressCountry: "US" } } : { address: { "@type": "PostalAddress", addressLocality: isNearby ? city : "Alpharetta", addressRegion: "GA", addressCountry: "US" } }),
    ...(p.phone ? { telephone: p.phone } : {}), ...(p.openingHours ? { openingHours: p.openingHours } : {}), ...(p.priceRange ? { priceRange: p.priceRange } : {}), ...(p.cuisine ? { servesCuisine: p.cuisine } : {}), ...(p.website ? { sameAs: [p.website] } : {})
  };
  const ldFaq = { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: faq.map(f => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })) };
  const telHref = p.phone ? "tel:+1" + p.phone.replace(/\D/g, "").replace(/^1/, "") : "";
  const actions = `<div class="pl-actions"><a class="btn btn-primary" href="${mapsLink(p)}" rel="noopener" target="_blank">Get directions</a>${p.phone ? `<a class="btn btn-ghost" href="${telHref}">Call ${esc(p.phone)}</a>` : ""}${p.website ? `<a class="btn btn-ghost" href="${esc(p.website)}" rel="noopener ${p.premium ? "sponsored" : "nofollow"}" target="_blank">Visit website</a>` : ""}${p.premium && p.booking ? `<a class="btn btn-primary" href="${esc(p.booking)}" rel="noopener sponsored" target="_blank">Book now</a>` : ""}</div>`;
  const facts = `<dl class="pl-facts">
      <div><dt>Category</dt><dd><a href="${listUrl}">${esc(catLabel(p.cat))}</a></dd></div>
      <div><dt>Type</dt><dd>${esc(p.type)}</dd></div>
      <div><dt>${p.address ? "Address" : "Area"}</dt><dd>${esc(p.address || p.area || "Alpharetta, GA")}</dd></div>
      ${p.hours ? `<div><dt>Hours</dt><dd>${esc(p.hours)}</dd></div>` : ""}
      ${p.phone ? `<div><dt>Phone</dt><dd><a href="${telHref}">${esc(p.phone)}</a></dd></div>` : ""}
      ${p.website ? `<div><dt>Website</dt><dd><a href="${esc(p.website)}" rel="noopener nofollow" target="_blank">${esc(hostOf(p.website))}</a></dd></div>` : ""}
      ${p.checked ? `<div><dt>Details checked</dt><dd>${new Date(p.checked + "T12:00:00Z").toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" })}</dd></div>` : ""}
    </dl>`;
  const miniList = (title, list) => list.length ? `<section class="pl-section"><h2>${title}</h2><ul class="pl-mini">${list.map(x => `<li><a href="/places/${x.slug}/"><strong>${esc(x.name)}</strong><span>${esc(x.type)}${x.area ? " &middot; " + esc(x.area) : ""}</span></a></li>`).join("")}</ul></section>` : "";
  const extras = [p.hours ? "Hours" : "", p.phone ? "Phone" : "", p.cat === "restaurants" ? "Menu" : "", street ? "Address" : ""].filter(Boolean).slice(0, 3);
  const nameHasCity = new RegExp(city, "i").test(p.name);
  const lead = nameHasCity ? `${p.name} in ${city}, GA` : `${p.name} ${city}, GA`;
  const title = p.title || ((p.hours || p.phone) && p.cat !== "coming-soon" ? `${lead}: ${extras.join(", ").replace(/, ([^,]*)$/, " & $1")}` : `${p.name}, ${city} GA: ${p.type}${p.cat === "restaurants" && street ? ", " + street.split(",")[0] : ""}`);
  const body = `
<section class="pl-head"><div class="wrap">
  ${crumbsHTML(crumbs)}
  <div class="pl-title">${p.premium && p.logo ? `<img class="pl-logo" src="${p.logo}" alt="${esc(p.name)} logo" width="88" height="88">` : ""}<div><span class="pill ver" style="background:rgba(255,255,255,.14);color:#fff">${esc(catLabel(p.cat))}</span>${p.premium ? ' <span class="pill feat">Featured</span>' : ""}<h1>${esc(p.name)}</h1><p>${esc(p.type)}${p.area ? " &middot; " + areaLink(p.area) : ""}</p></div></div>
  ${actions}
</div></section>
<div class="wrap">${sponsor()}</div>
<div class="wrap pl-grid">
  <article class="pl-main">
    <section class="pl-section"><h2>About ${esc(p.name)}</h2>
      ${p.status ? `<p class="pl-lede" style="border-left:4px solid #c9a227;padding-left:12px"><strong>Status:</strong> ${esc(p.status)}</p>` : ""}
      ${p.about && p.about.length ? p.about.map((t, i) => `<p${i === 0 ? ' class="pl-lede"' : ""}>${esc(t)}</p>`).join("") : `<p class="pl-lede">${esc(p.desc)}</p>`}
      <p>${esc(p.name)} is ${areaText}. ${p.cat === "restaurants" ? `It is one of ${places.filter(x => x.cat === "restaurants").length} places to eat and drink in our <a href="/restaurants/">Alpharetta restaurant guide</a>${p.cuisine ? `, and part of the city's ${esc(p.cuisine)} dining scene` : ""}.` : `Browse more ${esc(catLabel(p.cat).toLowerCase())} in our <a href="${listUrl}">Alpharetta directory</a>.`}</p>
      ${p.link ? `<p><a href="${p.link}">Read our full guide</a></p>` : ""}
    </section>
    ${p.premium && p.deals ? `<section class="pl-section pl-deal"><h2>Current special</h2><p>${esc(p.deals)}</p>${p.booking ? `<a class="btn btn-primary" href="${esc(p.booking)}" rel="noopener sponsored" target="_blank">Book now</a>` : ""}</section>` : ""}
    ${p.premium && p.photos && p.photos.length ? `<section class="pl-section"><h2>Photos of ${esc(p.name)}</h2><div class="pl-gallery">${p.photos.map((u, i) => `<a href="${u}" target="_blank" rel="noopener"><img src="${u}" alt="${esc(p.name)} photo ${i + 1}" loading="lazy"></a>`).join("")}</div></section>` : ""}
    ${p.premium && (p.facebook || p.instagram) ? `<section class="pl-section"><h2>Follow ${esc(p.name)}</h2><p class="pl-social">${p.facebook ? `<a href="${esc(p.facebook)}" rel="noopener sponsored" target="_blank">Facebook</a>` : ""}${p.instagram ? `<a href="${esc(p.instagram)}" rel="noopener sponsored" target="_blank">Instagram</a>` : ""}</p></section>` : ""}
    ${(() => { const rows = weekHours(p.hours); if (!rows) return ""; const fx = hoursFacts(rows); const notes = [fx.closed.length ? `Closed ${dayList(fx.closed)}.` : `Open seven days a week.`, fx.early.length ? `Opens early (7:30am or before) on ${dayList(fx.early)}.` : "", fx.late.length ? `Open late (9:30pm or later) on ${dayList(fx.late)}.` : ""].filter(Boolean).join(" "); return `<section class="pl-section"><h2>${esc(p.name)} hours by day</h2><table class="hours-table"><tbody>${rows.map(([d, v]) => `<tr><th scope="row">${DAY_FULL[d]}</th><td>${v ? (v === "closed" ? "Closed" : esc(v)) : "Not listed"}</td></tr>`).join("")}</tbody></table><p>${notes} Holiday hours can differ${p.phone ? `, so call ${esc(p.phone)} before a holiday visit` : ""}.${p.checked ? ` Hours last checked ${new Date(p.checked + "T12:00:00Z").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" })}.` : ""}</p></section>`; })()}
    ${(() => { const pool = places.filter(x => x.slug !== p.slug && x.cat === p.cat && x.cat !== "coming-soon" && (p.cuisine ? x.cuisine === p.cuisine : x.type === p.type)); const fill = pool.length < 4 ? places.filter(x => x.slug !== p.slug && x.cat === p.cat && !pool.includes(x) && x.area === p.area) : []; const list = pool.concat(fill).filter(x => x.hours || x.phone).slice(0, 6); if (list.length < 2) return ""; const sun = (x) => { const v = dayHours(x.hours, "Sun"); return v ? (v === "closed" ? "Closed" : esc(v)) : "&ndash;"; }; return `<section class="pl-section"><h2>Compare ${esc(p.name)} with similar ${p.cat === "restaurants" ? "restaurants" : "places"}</h2><div class="table-wrap"><table class="compare-table"><thead><tr><th>Name</th><th>Area</th><th>Sunday</th><th>Phone</th></tr></thead><tbody><tr class="is-current"><td><strong>${esc(p.name)}</strong></td><td>${esc((p.area || "Alpharetta").replace(" (nearby)", ""))}</td><td>${sun(p)}</td><td>${p.phone ? esc(p.phone) : "&ndash;"}</td></tr>${list.map(x => `<tr><td><a href="/places/${x.slug}/">${esc(x.name)}</a></td><td>${esc((x.area || "Alpharetta").replace(" (nearby)", ""))}</td><td>${sun(x)}</td><td>${x.phone ? esc(x.phone) : "&ndash;"}</td></tr>`).join("")}</tbody></table></div></section>`; })()}
    ${AREA_GUIDE[p.area] ? `<section class="pl-section"><h2>Visiting ${esc(p.area.replace(" (nearby)", ""))}</h2><p>${AREA_GUIDE[p.area]}</p>${districtLinks(p)}</section>` : districtLinks(p) ? `<section class="pl-section">${districtLinks(p)}</section>` : ""}
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
  <ul class="event-list">${events.map(e => `<li class="event-item" id="${e.slug}">${e.image ? `<div class="ev-img"><img src="${e.image}" alt="${esc(e.title)}" loading="lazy" width="320" height="180"><div class="date">${dateChip(e, true)}</div></div>` : `<div class="date">${dateChip(e, true)}</div>`}
    <div><h3>${esc(e.title)}</h3><div class="when">${evWhen(e)}${e.time ? " &middot; " + esc(e.time) : ""}</div>
    ${e.estimated ? `<p class="ev-est">Estimated date: ${esc(e.estimated)}.</p>` : ""}<p>${esc(e.desc)}</p><p><strong>${e.venueSlug ? `<a href="/places/${e.venueSlug}/">${esc(e.venue)}</a>` : esc(e.venue)}</strong>${e.address ? ", " + esc(e.address) : ""}</p>${e.priceText ? `<p class="ev-price">${esc(e.priceText)}</p>` : ""}${e.url ? `<p><a href="${esc(e.url)}" rel="noopener" target="_blank">Event details</a></p>` : ""}</div></li>`).join("")}</ul>
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

// ---------- Area pages ----------
{
  const names = Object.keys(AREA_COUNTS).filter(n => AREA_COUNTS[n] >= 3 && n !== "Avalon" && n !== "Halcyon").sort((a, b) => AREA_COUNTS[b] - AREA_COUNTS[a]);
  for (const n of names) {
    const list = places.filter(p => areaName(p.area) === n);
    const key = Object.keys(AREA_GUIDE).find(k => areaName(k) === n) || Object.keys(AREA_TEXT).find(k => areaName(k) === n);
    const where = AREA_TEXT[key] ? AREA_TEXT[key].replace(/^(in|on|at|along) /, "") : `the ${n} area`;
    const cats = [...new Set(list.map(p => catLabel(p.cat).toLowerCase()))].slice(0, 5);
    const intro = listIntro(`<p>${list.length} places ${AREA_TEXT[key] ? AREA_TEXT[key] : "in " + esc(n)}, from ${cats.join(", ").replace(/, ([^,]*)$/, " and $1")}. Every listing has an address and, where available, hours and a phone number.</p>${AREA_GUIDE[key] ? `<p>${AREA_GUIDE[key]}</p>` : ""}<p>Other parts of town: ${names.filter(x => x !== n).slice(0, 8).map(x => `<a href="/areas/${slugify(x)}/">${esc(x)}</a>`).concat(['<a href="/avalon/">Avalon</a>', '<a href="/halcyon/">Halcyon</a>']).join(" &middot; ")}.</p>`);
    directoryPage({ urlPath: `/areas/${slugify(n)}/`, crumbs: [["Home", "/"], ["Areas", "/areas/"], [n, `/areas/${slugify(n)}/`]],
      h1: `${n}, Alpharetta: restaurants, shops and services`, sub: `Everything we list ${where.length < 90 ? "in " + n : "in this part of Alpharetta"}, with hours and phone numbers.`,
      title: `${n} Alpharetta, GA: ${list.length} Restaurants, Shops & Services (${new Date(BUILD_DATE).getFullYear()})`,
      description: `${list.length} places in ${n}, Alpharetta, GA: restaurants, shops, services and things to do, with addresses, hours and phone numbers.`,
      list, intro });
  }
  const crumbs = [["Home", "/"], ["Areas", "/areas/"]];
  const all = [["Avalon", "/avalon/", AREA_COUNTS["Avalon"]], ["Halcyon", "/halcyon/", AREA_COUNTS["Halcyon"]], ...names.map(n => [n, `/areas/${slugify(n)}/`, AREA_COUNTS[n]])];
  const body = pageHead(crumbs, "Alpharetta by area", "Browse restaurants, shops and services by neighborhood and corridor.") + `<section class="wrap" style="padding:36px 0 50px"><div class="cats">${all.map(([n, u, c]) => `<a class="cat" href="${u}"><svg viewBox="0 0 64 64"><use href="#logo"/></svg><div><strong>${esc(n)}</strong><span>${c || ""} places</span></div></a>`).join("")}</div></section>`;
  add("/areas/", layout({ title: "Alpharetta, GA Neighborhoods and Areas: Browse by Part of Town", description: "Browse Alpharetta, GA restaurants, shops and services by area: Avalon, Downtown Alpharetta, Windward, North Point, Halcyon, Crabapple and more.", urlPath: "/areas/", body, jsonld: [crumbsLD(crumbs)] }), "0.7");
}

// ---------- Neighborhood guides (Avalon, Halcyon): a hub page plus subpages per district ----------
// Data: src/data/districts.json. Content: src/content/districts/<district>/<page>.html (hub = index.html).
// In content, <!--table:slug,slug,...--> renders a table of listings (name, what, hours, phone) from places.json.
const DISTRICTS = fs.existsSync(path.join(SRC, "data/districts.json")) ? json("data/districts.json") : {};
const placeTable = (slugs) => {
  const rows = slugs.map(s => places.find(p => p.slug === s.trim())).filter(Boolean);
  return `<table><thead><tr><th>Place</th><th>What it is</th><th>Hours</th><th>Phone</th></tr></thead><tbody>${rows.map(p => `<tr><td><a href="/places/${p.slug}/">${esc(p.name)}</a></td><td>${esc(p.type)}${p.priceRange ? " &middot; " + esc(p.priceRange) : ""}</td><td>${esc(p.hours || "Varies, call ahead")}</td><td>${p.phone ? `<a href="tel:${p.phone.replace(/\D/g, "")}">${esc(p.phone)}</a>` : "&ndash;"}</td></tr>`).join("")}</tbody></table>`;
};
for (const [key, d] of Object.entries(DISTRICTS)) {
  const all = [{ slug: "", label: d.hubLabel || "Overview", ...d.hub }, ...d.pages];
  for (const pg of all) {
    const urlPath = `/${key}/${pg.slug ? pg.slug + "/" : ""}`;
    const crumbs = [["Home", "/"], [d.name, `/${key}/`], ...(pg.slug ? [[pg.label, urlPath]] : [])];
    let content = read(`content/districts/${key}/${pg.slug || "index"}.html`);
    content = content.replace(/<!--table:([^>]*?)-->/g, (m, list) => placeTable(list.split(",")));
    const toc = [...content.matchAll(/<h2 id="([^"]+)">(.*?)<\/h2>/g)];
    const subnav = `<nav class="district-nav" aria-label="${esc(d.name)} guide">${all.map(x => { const u = `/${key}/${x.slug ? x.slug + "/" : ""}`; return `<a href="${u}"${u === urlPath ? ' aria-current="page"' : ""}>${esc(x.label)}</a>`; }).join("")}</nav>`;
    const others = all.filter(x => x !== pg);
    const listings = (pg.listings || []).map(s => places.find(p => p.slug === s)).filter(Boolean);
    const glance = `<div class="pl-card"><h2>${esc(d.name)} at a glance</h2><dl>${d.glance.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${v}</dd></div>`).join("")}</dl><p style="font-size:13px;margin:12px 0 0;color:var(--muted)">Details checked ${fmtDate(d.checked)}.</p></div>`;
    const body = pageHead(crumbs, esc(pg.h1), esc(pg.sub || ""), subnav) + `
<div class="wrap body-grid">
  <article class="prose">
    ${content}
    ${listings.length ? `<h2 id="listings">${esc(pg.listingsHeading || "Listings in our directory")}</h2><div class="listings district-listings">${listings.map(listingCard).join("")}</div>` : ""}
    ${(() => { const prem = places.filter(p => p.premium && (p.mentions || []).some(m => m.toLowerCase().startsWith(d.name.toLowerCase()))); return prem.length ? `<h2 id="featured-businesses">Featured ${esc(d.name)} businesses</h2><div class="listings district-listings">${prem.map(listingCard).join("")}</div>` : ""; })()}
    ${pg.faqs && pg.faqs.length ? `<section class="faq" id="faq"><h2>Frequently asked questions</h2>${pg.faqs.map(f => `<details><summary>${esc(f.q)}</summary><p>${f.a}</p></details>`).join("")}</section>` : ""}
    <div class="related"><h2>More in our ${esc(d.name)} guide</h2><ul class="guide-links">${others.map(x => `<li><a href="/${key}/${x.slug ? x.slug + "/" : ""}">${esc(x.h1)}</a></li>`).join("")}</ul></div>
    ${d.sources ? `<section class="sources"><h2 style="font-size:20px">Sources</h2><ul>${d.sources.map(s => `<li><a href="${esc(s.url)}" rel="noopener" target="_blank">${esc(s.name)}</a></li>`).join("")}</ul><p>Hours, menus and event dates change. Spot something out of date? Email <a href="mailto:hello@alpharettalist.com">hello@alpharettalist.com</a></p></section>` : ""}
    <div class="author-box"><span class="logo-tile"><svg width="36" height="36" viewBox="0 0 64 64"><use href="#logo"/></svg></span><span>Written by the Alpharetta List team, an independent local guide covering Alpharetta, Georgia. Not affiliated with ${esc(d.name)}.</span></div>
  </article>
  <aside><div class="sticky-rail">
    ${glance}
    ${toc.length ? `<nav class="toc" aria-label="On this page" style="margin-top:20px"><h2>On this page</h2><ol>${toc.map(m => `<li><a href="#${m[1]}">${m[2]}</a></li>`).join("")}${pg.faqs && pg.faqs.length ? '<li><a href="#faq">FAQ</a></li>' : ""}</ol></nav>` : ""}
  </div></aside>
</div>`;
    const ld = [crumbsLD(crumbs), { "@context": "https://schema.org", "@type": "WebPage", name: pg.title, description: pg.meta, url: SITE + urlPath, dateModified: d.checked, about: { "@type": d.schema || "Place", name: d.name, address: { "@type": "PostalAddress", streetAddress: d.street, addressLocality: "Alpharetta", addressRegion: "GA", postalCode: d.zip, addressCountry: "US" } }, publisher: { "@id": SITE + "/#org" } }];
    if (pg.faqs && pg.faqs.length) ld.push({ "@context": "https://schema.org", "@type": "FAQPage", mainEntity: pg.faqs.map(f => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a.replace(/<[^>]+>/g, "") } })) });
    add(urlPath, layout({ title: pg.title, description: pg.meta, urlPath, body, jsonld: ld }), pg.slug ? "0.8" : "0.9", d.checked);
  }
}

// ---------- Forms ----------
const formPage = ({ urlPath, crumb, h1, sub, title, description, form, side, faqs = [] }) => {
  const crumbs = [["Home", "/"], [crumb, urlPath]];
  const faqHTML = faqs.length ? `<div class="prose" style="margin-top:36px"><h2 style="font-family:var(--serif);font-weight:500;font-size:26px">Frequently asked questions</h2>${faqs.map(f => `<h3 style="font-size:17px;margin:18px 0 4px">${f.q}</h3><p>${f.a}</p>`).join("")}</div>` : "";
  const body = pageHead(crumbs, h1, sub) + `<div class="wrap body-grid"><div>${form}${faqHTML}</div><aside><div class="sticky-rail">${side || sponsor("rect")}</div></aside></div>${newsletter}`;
  add(urlPath, layout({ title, description, urlPath, body, jsonld: [crumbsLD(crumbs), ...(faqs.length ? [{ "@context": "https://schema.org", "@type": "FAQPage", mainEntity: faqs.map(f => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a.replace(/<[^>]+>/g, "") } })) }] : [])] }), "0.5");
};
const hp = `<span class="hp"><label>Leave blank<input name="website_url_hp" tabindex="-1" autocomplete="off"></label></span>`;
const catOptions = CATS.filter(c => c.id !== "coming-soon" && c.id !== "nearby").map(c => `<option>${c.label}</option>`).join("");

const MAIL = "hello@alpharettalist.com";
const emailBox = (subject, intro, items, note) => `<div class="email-box">
  <p class="lede" style="margin-top:0">${intro}</p>
  <a class="btn btn-primary email-btn" href="mailto:${MAIL}?subject=${encodeURIComponent(subject)}">Email ${MAIL}</a>
  <h2 style="font-family:var(--serif);font-weight:500;font-size:24px;margin:28px 0 10px">What to include</h2>
  <ul class="tips">${items.map(t => `<li>${t}</li>`).join("")}</ul>
  <p style="color:var(--muted);margin-top:18px">${note}</p>
</div>`;
// ---------- Add your business: Free vs Featured, free self-serve form, Stripe checkout ----------
const STRIPE_MONTHLY = "https://buy.stripe.com/eVq5kE5wp7Gub2f68E1Fe0k";
const STRIPE_LIFETIME = "https://buy.stripe.com/5kQ00k2kdgd02vJ68E1Fe0l";
const MENTION_OPTIONS = ["Avalon guide", "Halcyon guide", "Downtown Alpharetta restaurant guide", "Holiday and seasonal guides", "Kids and family guides", "Dog-friendly guide", "Senior living guide", "Our related services page", "Events roundups"];
const hoursInputs = () => `<fieldset class="hours-fields"><legend>Hours <span class="hint">Use a format like 9am-5pm, or type closed</span></legend><div class="hours-grid">${["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(d => `<label><span>${d}</span><input name="h_${d}" placeholder="${d === "Sun" ? "closed" : "9am-5pm"}" autocomplete="off"></label>`).join("")}</div><input type="hidden" name="hours"></fieldset>`;
const bizCoreFields = (descHint, minWords) => `
  <div class="row"><label>Business name *<input name="business_name" required maxlength="80"></label>
  <label>Category *<select name="category" required><option value="">Choose one</option>${CATS.filter(c => !["coming-soon", "nearby"].includes(c.id)).map(c => `<option value="${c.id}">${c.label}</option>`).join("")}</select></label></div>
  <div class="row"><label>Type of business *<input name="subcategory" required maxlength="60" placeholder="e.g. Sushi restaurant, HVAC, Pediatric dentist"></label>
  <label>Phone *<input name="phone" type="tel" required placeholder="(770) 555-0123"></label></div>
  <label>Street address *<input name="address" required placeholder="123 Main St, Alpharetta, GA 30009"><span class="hint">Must be in or near Alpharetta, GA, including the ZIP code.</span></label>
  <label>Website<input name="website" type="url" placeholder="https://"></label>
  ${hoursInputs()}
  <label>Description * <span class="hint">${descHint} <span class="wc" data-min="${minWords}">0 words</span></span><textarea name="description" required data-minwords="${minWords}"></textarea></label>`;

{
  const urlPath = "/add-your-business/";
  const crumbs = [["Home", "/"], ["Add your business", urlPath]];
  const nPlaces = places.length;
  const nGuides = posts.length + Object.values(DISTRICTS).reduce((n, d) => n + 1 + d.pages.length, 0);
  const tick = '<svg class="ck" viewBox="0 0 20 20" aria-hidden="true"><path d="M7.6 13.6 4.3 10.3l-1.2 1.2 4.5 4.5 9.4-9.4-1.2-1.2z"/></svg>';
  const no = '<span class="nx" aria-hidden="true">&ndash;</span>';
  const rows = [
    ["Your own listing page", tick, tick],
    ["Name, address, phone and hours", tick, tick],
    ["Description of your business", "Up to 150 words", "Up to 600 words"],
    ["Placement in your category and service pages", "Standard order", "<strong>Pinned to the top</strong>"],
    ["Featured badge on every card and page", no, tick],
    ["Logo on your listing", no, tick],
    ["Photo gallery", no, "<strong>Up to 10 photos</strong>"],
    ["Deals and specials box", no, tick],
    ["Book now / reservation button", no, tick],
    ["Facebook and Instagram links", no, tick],
    ["Mentions in related guides (Avalon, Halcyon, holiday, kids and more)", no, tick],
    ["Priority updates whenever your hours or info change", no, tick],
    ["Review before going live", "Automatic checks", "Personal setup by our team"]
  ];
  const faqs = [
    { q: "Is the free listing really free?", a: "Yes. A basic listing with your name, address, phone, hours and a short description is free. Fill out the form on this page and, if it passes our checks, it usually goes live within the hour." },
    { q: "What do I get with a Featured listing?", a: "Your business is pinned to the top of its category and service pages with a Featured badge, and your page gets your logo, up to 10 photos, a deals box, a booking button, social links, a longer write-up and mentions in related Alpharetta guides." },
    { q: "How does Lifetime work?", a: "Lifetime is a single $49 payment at our founding price. Your listing stays Featured for as long as Alpharetta List runs, with no monthly bill. The founding price will go up as the site grows." },
    { q: "Can I cancel the monthly plan?", a: "Yes, anytime. Your listing goes back to a free listing at the end of the billing period, and nothing else changes." },
    { q: "What happens after I pay?", a: "Stripe takes you straight to a setup page where you upload your logo and photos and fill in your details. Your Featured listing goes through quick automatic checks and usually goes live within the hour." },
    { q: "My business is already listed. Can I upgrade it?", a: "Yes. Choose Featured, and on the setup page paste the link to your current listing. We upgrade that page instead of creating a new one." },
    { q: "Which businesses qualify?", a: "Businesses located in Alpharetta, or service businesses that regularly serve Alpharetta homes and companies, including nearby Milton, Roswell, Johns Creek and south Forsyth. We do not list adult businesses, gambling, or anything misleading." }
  ];
  const body = pageHead(crumbs, "Get your business found in Alpharetta", "People search Alpharetta List every day for restaurants, services and things to do. List your business free, or get Featured and stand out from day one.",
    `<div class="head-stats"><span><b>${nPlaces}</b> local listings</span><span><b>${nGuides}</b> local guides</span><span>Free basic listings</span><span>Featured from <b>$19</b>/mo</span></div>`) + `
<section class="wrap biz-sec">
  <div class="plans">
    <div class="plan">
      <div class="plan-name">Free listing</div>
      <div class="plan-price"><b>$0</b></div>
      <p class="plan-sub">The basics, so locals can find you.</p>
      <ul class="plan-list"><li>${tick}<span>Your own listing page</span></li><li>${tick}<span>Name, address, phone and hours</span></li><li>${tick}<span>Short description</span></li><li>${tick}<span>Listed in your category</span></li></ul>
      <a class="btn btn-ghost plan-btn" href="#free-form">Create a free listing</a>
    </div>
    <div class="plan plan-featured">
      <div class="plan-flag">Founding price &middot; Most popular</div>
      <div class="plan-name">Featured listing</div>
      <div class="plan-price"><b>$19</b><span>/month</span><em>or $49 once for lifetime</em></div>
      <p class="plan-sub">Everything in Free, plus top placement and a page that sells for you.</p>
      <ul class="plan-list">${["<strong>Pinned to the top</strong> of your category", "Featured badge everywhere you appear", "Logo plus <strong>up to 10 photos</strong>", "Book now button and social links", "Deals and specials box", "Mentions in related Alpharetta guides", "Longer write-up, up to 600 words"].map(t => `<li>${tick}<span>${t}</span></li>`).join("")}</ul>
      <a class="btn btn-primary plan-btn" href="${STRIPE_MONTHLY}" rel="noopener">Get Featured for $19/month</a>
      <a class="btn btn-gold-ghost plan-btn" href="${STRIPE_LIFETIME}" rel="noopener">Or pay $49 once, Featured for life</a>
      <p class="plan-fine">Secure checkout by Stripe. Monthly plan cancels anytime. After checkout you'll upload your logo and photos.</p>
    </div>
  </div>

  <h2 class="biz-h">Why businesses go Featured</h2>
  <div class="plan-why">
    <div><b>Top of the list</b><span>Featured listings show first in your category, ahead of the other ${nPlaces}+ businesses on Alpharetta List.</span></div>
    <div><b>Logo, photos, booking</b><span>Up to 10 photos, your logo and a Book now button turn your listing into a mini website.</span></div>
    <div><b>$49 one time</b><span>Pay once and stay Featured for as long as the site runs. No renewals, no contract.</span></div>
  </div>

  <h2 class="biz-h">Free vs. Featured, side by side</h2>
  <div class="table-wrap"><table class="compare-table plan-table"><thead><tr><th></th><th>Free</th><th>Featured</th></tr></thead><tbody>${rows.map(r => `<tr><td>${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td></tr>`).join("")}<tr><td><strong>Price</strong></td><td>$0</td><td><strong>$19/month</strong> or <strong>$49 lifetime</strong></td></tr></tbody></table></div>
  <div class="plan-cta-row"><a class="btn btn-primary" href="${STRIPE_MONTHLY}" rel="noopener">Get Featured for $19/month</a><a class="btn btn-gold-ghost" href="${STRIPE_LIFETIME}" rel="noopener">$49 lifetime</a><span>Founding price. It goes up as the site grows, so lock it in now.</span></div>
</section>

<section class="wrap body-grid biz-form-wrap" id="free-form">
  <div>
    <h2 class="biz-h" style="margin-top:0">Create your free listing</h2>
    <p class="lede" style="margin-top:0">Takes about two minutes. Listings that pass our automatic checks usually go live within the hour. Want photos, your logo and top placement? <a href="${STRIPE_MONTHLY}" rel="noopener">Go Featured</a> instead.</p>
    <form class="form biz-form" data-wl-form="Businesses" data-success="Thanks! Your listing is in. If it passes our checks it will usually go live within the hour, and we'll email you if we have any questions.">
      ${bizCoreFields("25 to 150 words. What you do, who you serve, what makes you different.", 25)}
      <div class="row"><label>Your name<input name="contact_name" autocomplete="name"></label>
      <label>Your email * <span class="hint">Never published</span><input name="email" type="email" required autocomplete="email"></label></div>
      <input type="hidden" name="claim_listing">
      ${hp}
      <label class="check"><input type="checkbox" required> I own or manage this business, and the details are accurate.</label>
      <button class="btn btn-primary" type="submit">Submit free listing</button>
      <p class="status" role="status"></p>
    </form>
    <div class="prose" style="margin-top:40px"><h2 style="font-family:var(--serif);font-weight:500;font-size:26px">Frequently asked questions</h2>${faqs.map(f => `<h3 style="font-size:17px;margin:18px 0 4px">${f.q}</h3><p>${f.a}</p>`).join("")}</div>
  </div>
  <aside><div class="sticky-rail"><div class="info-card plan-side"><strong>Want to stand out?</strong><p>Featured businesses are pinned above every free listing in their category, with photos, a logo and a booking button.</p><a class="btn btn-primary" href="${STRIPE_MONTHLY}" rel="noopener">$19/month</a><a class="btn btn-gold-ghost" href="${STRIPE_LIFETIME}" rel="noopener">$49 lifetime</a><p class="plan-fine">Already listed? You can upgrade your existing page.</p></div></div></aside>
</section>${newsletter}`;
  add(urlPath, layout({
    title: "Add Your Business to Alpharetta List | Free & Featured Listings in Alpharetta, GA",
    description: "List your Alpharetta, GA business free, or get Featured from $19/month ($49 lifetime founding price): top placement, logo, 10 photos, booking button and guide mentions.",
    urlPath, body,
    jsonld: [crumbsLD(crumbs), { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: faqs.map(f => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })) },
      { "@context": "https://schema.org", "@type": "Product", name: "Alpharetta List Featured Listing", description: "Featured business listing on AlpharettaList.com", brand: { "@type": "Brand", name: "Alpharetta List" },
        offers: [{ "@type": "Offer", price: "19.00", priceCurrency: "USD", url: STRIPE_MONTHLY, availability: "https://schema.org/InStock" }, { "@type": "Offer", price: "49.00", priceCurrency: "USD", url: STRIPE_LIFETIME, availability: "https://schema.org/InStock" }] }]
  }), "0.8");
}

// ---------- Featured setup page (after Stripe checkout, noindex) ----------
{
  const urlPath = "/featured/setup/";
  const body = pageHead([["Home", "/"], ["Featured setup", urlPath]], "Set up your Featured listing", "Thank you for going Featured! Fill this out once and we'll build your listing. It usually goes live within the hour.") + `
<section class="wrap body-grid">
  <div>
    <div class="setup-paid" id="setup-paid" hidden><strong>Payment received.</strong> <span id="setup-plan"></span> Keep this page open until you hit submit.</div>
    <div class="setup-unpaid" id="setup-unpaid" hidden>Haven't checked out yet? <a href="${STRIPE_MONTHLY}">Get Featured for $19/month</a> or <a href="${STRIPE_LIFETIME}">$49 lifetime</a> first, then come back here.</div>
    <form class="form biz-form" id="featured-form" data-featured-form>
      <label>Already listed? Paste your current listing link <span class="hint">Optional. We'll upgrade that page.</span><input name="existing_listing" placeholder="https://alpharettalist.com/places/..."></label>
      ${bizCoreFields("60 to 600 words. Tell customers your story, services, specialties and what to expect.", 60)}
      <h3 class="setup-h">Logo and photos</h3>
      <label>Logo <span class="hint">PNG or JPG, square works best</span><input type="file" name="logo_file" accept="image/png,image/jpeg,image/webp"></label>
      <label>Photos <span class="hint">Up to 10. Storefront, interior, team, products, food. We resize them for fast loading.</span><input type="file" name="photo_files" accept="image/png,image/jpeg,image/webp" multiple></label>
      <div class="photo-previews" id="photo-previews"></div>
      <h3 class="setup-h">Extras</h3>
      <label>Current deal or special <span class="hint">e.g. 10% off your first visit</span><input name="deals" maxlength="200"></label>
      <label>Booking or reservation link<input name="booking_url" type="url" placeholder="https://"></label>
      <div class="row"><label>Facebook page<input name="facebook" type="url" placeholder="https://facebook.com/..."></label>
      <label>Instagram<input name="instagram" type="url" placeholder="https://instagram.com/..."></label></div>
      <fieldset class="mention-fields"><legend>Where should we mention you? <span class="hint">Pick any that fit your business</span></legend>${MENTION_OPTIONS.map(m => `<label class="check"><input type="checkbox" name="mention_in" value="${m}"> ${m}</label>`).join("")}</fieldset>
      <h3 class="setup-h">Your contact info <span class="hint">Never published</span></h3>
      <div class="row"><label>Your name *<input name="contact_name" required autocomplete="name"></label>
      <label>Email you used at checkout *<input name="email" type="email" required autocomplete="email"></label></div>
      ${hp}
      <button class="btn btn-primary" type="submit" id="featured-submit">Submit my Featured listing</button>
      <p class="status" role="status" id="featured-status"></p>
    </form>
  </div>
  <aside><div class="sticky-rail"><div class="info-card"><strong>What happens next</strong><ul class="tips"><li>Quick automatic checks on your details and photos</li><li>Your Featured listing goes live, usually within the hour</li><li>You're pinned to the top of your category</li><li>Need a change later? Email <a href="mailto:hello@alpharettalist.com">hello@alpharettalist.com</a></li></ul></div></div></aside>
</section>`;
  write("featured/setup/index.html", layout({ title: "Set Up Your Featured Listing | Alpharetta List", description: "Finish setting up your Featured listing on Alpharetta List.", urlPath, body, noindex: true })); EXTRA_KEEP.push("featured/setup/index.html");
}

formPage({
  urlPath: "/submit-event/", crumb: "Submit an event", h1: "Submit an Alpharetta event",
  sub: "Community events, fundraisers, grand openings, shows and classes in or near Alpharetta. Free to submit.",
  title: "Submit an Event | Alpharetta, GA Events Calendar",
  description: "Add your Alpharetta, Georgia event to the Alpharetta List events calendar for free. Community events, fundraisers, grand openings and more.",
  form: emailBox("Event for the Alpharetta List calendar", "Hosting something in Alpharetta? Email us the details below and we'll add it to the calendar for free.",
    ["Event name", "Date(s) and start and end time", "Venue name and street address", "Price, or free", "A short description of the event", "Link to the official event page or tickets", "A photo or flyer, if you have one (attach it)"],
    "Send events at least a week ahead when possible. We may lightly edit descriptions for length."),
  faqs: [
    { q: "What kinds of events do you list?", a: "Community festivals, concerts, markets, fundraisers, holiday events, grand openings, classes and family activities in Alpharetta or close by in Milton, Roswell and Johns Creek. Events should be open to the public." },
    { q: "Does it cost anything to add an event?", a: "No. Adding an event to the <a href=\"/events/\">Alpharetta events calendar</a> is free." },
    { q: "How far ahead should I send my event?", a: "At least a week ahead is best, and earlier for big seasonal events. We check event details against the official event page before publishing." },
    { q: "Can I update an event after it's listed?", a: "Yes. Email us the event name and what changed, such as a new date, time, venue or price, and we'll update the listing." }
  ],
  side: `<div class="info-card"><strong>Good to know</strong><ul class="tips"><li>Listing events is free</li><li>We focus on events in or near Alpharetta</li><li>Recurring events can go in one email</li></ul></div>`
});

// ---------- Advertise ----------
{
  const crumbs = [["Home", "/"], ["Advertise", "/advertise/"]];
  const nPlaces = places.length, nEvents = events.length;
  const subj = encodeURIComponent("Advertising on Alpharetta List");
  const mailBtn = (cls = "btn btn-primary") => `<a class="${cls}" href="mailto:${MAIL}?subject=${subj}">Email ${MAIL}</a>`;
  const card = (t, d) => `<div class="ad-card"><svg class="ad-ico" viewBox="0 0 64 64" aria-hidden="true"><use href="#logo"/></svg><h3>${t}</h3><p>${d}</p></div>`;
  const faq = [
    ["Who reads Alpharetta List?", "People searching for Alpharetta, Georgia businesses, restaurants, things to do and events: residents, families who just moved to the area, people who work in Alpharetta's office corridors and visitors planning a trip to Avalon or downtown."],
    ["How much does it cost?", "Rates depend on the placement, the category and how long you want to run. Email us with what you have in mind and we'll send current availability and pricing."],
    ["Are sponsored placements labeled?", "Yes. Every paid placement is clearly marked as sponsored, so readers can trust the rest of the guide and your brand gets the credibility of appearing alongside it."],
    ["Do I have to advertise to be listed?", "No. Basic listings are always free. Advertising is for businesses that want more visibility than a standard listing."],
    ["How fast can a campaign go live?", "Usually within a few business days of receiving your artwork, copy and link."]
  ];
  const body = pageHead(crumbs, "Advertise on Alpharetta List", "Put your business in front of people actively searching for Alpharetta restaurants, services, things to do and events.",
    `<div class="ad-hero-cta">${mailBtn("btn btn-primary ad-hero-btn")}</div>
  <div class="head-stats"><span><b>${nPlaces}</b> local listings</span><span><b>${CATS.filter(c => places.some(p => p.cat === c.id)).length}</b> categories</span><span><b>${nEvents}</b> upcoming events</span></div>`) + `
<section class="wrap ad-sec">
  <div class="ad-intro"><p class="lede">Alpharetta List is the independent local guide to Alpharetta, Georgia. When someone looks up the best sushi near Avalon, a plumber in North Fulton or what's happening downtown this weekend, they land on our pages. Sponsoring Alpharetta List puts your business right where those decisions get made.</p></div>
  <h2 class="ad-h">Why sponsor Alpharetta List</h2>
  <div class="ad-grid">
    ${card("High-intent local readers", "Our visitors aren't scrolling past. They're looking for a place to eat, a service to hire or something to do in Alpharetta, right now.")}
    ${card("100% Alpharetta focused", "No wasted reach across all of metro Atlanta. Every page is about Alpharetta and the neighborhoods around it, from Avalon to Windward to downtown.")}
    ${card("A trusted, uncluttered guide", "We keep the site clean, with no pop-ups and no wall of banner ads. A sponsor stands out instead of getting lost.")}
  </div>
  <h2 class="ad-h">Ways to sponsor</h2>
  <div class="ad-grid ad-grid-2">
    ${card("Directory sponsor", "Become the presenting sponsor of the Alpharetta List directory or one category, like Eat and Drink, Home services or Health and medical, with your brand at the top of the page.")}
    ${card("Featured listing", "Pin your business to the top of its category with a highlighted card, your logo and a direct link to your site or booking page.")}
    ${card("Sponsored guide", "A dedicated, clearly labeled article about your business, menu, opening or offer, written for local readers and promoted across the site.")}
    ${card("Events calendar sponsor", "Promote your event or venue at the top of the Alpharetta events calendar, one of the most-visited pages for things to do.")}
  </div>
  <p class="ad-note">Have something else in mind? Grand openings, seasonal promotions and multi-location packages are welcome. Just ask.</p>
  <h2 class="ad-h">How it works</h2>
  <ol class="ad-steps">
    <li><strong>Email us</strong><span>Tell us about your business and which placement interests you.</span></li>
    <li><strong>Get rates and availability</strong><span>We'll reply with current pricing and open dates, usually within one business day.</span></li>
    <li><strong>Go live</strong><span>Send your logo, copy and link, and your placement launches within a few business days.</span></li>
  </ol>
  <div class="ad-contact">
    <div><h2>Let's get your business in front of Alpharetta</h2><p>Email us at <a href="mailto:${MAIL}?subject=${subj}">${MAIL}</a> and include your business name, website, the placement you're interested in and your ideal start date.</p></div>
    ${mailBtn("btn btn-primary ad-hero-btn")}
  </div>
  <h2 class="ad-h">Questions</h2>
  <div class="ad-faq">${faq.map(([q, a]) => `<details><summary>${q}</summary><p>${a}</p></details>`).join("")}</div>
  <p class="ad-note" style="margin-top:28px">Just want a free listing? <a href="/add-your-business/">Add your business here</a>.</p>
</section>`;
  const ld = [crumbsLD(crumbs), { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: faq.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })) }];
  add("/advertise/", layout({ title: "Advertise on Alpharetta List | Sponsor the Alpharetta, GA Directory", description: "Sponsor the Alpharetta List directory and reach people searching for Alpharetta, Georgia restaurants, businesses, services and events. Email us for rates.", urlPath: "/advertise/", body, jsonld: ld }), "0.6");
}

// ---------- About, contact, terms, privacy, 404 ----------
{
  const crumbs = [["Home", "/"], ["About", "/about/"]];
  const nPlaces = places.length;
  add("/about/", layout({ title: "About Alpharetta List | Independent Local Guide to Alpharetta, GA", description: "Who runs Alpharetta List, how we research our guides and directory, our editorial standards and how to reach us.", urlPath: "/about/",
    body: pageHead(crumbs, "About Alpharetta List", "An independent local guide to Alpharetta, Georgia.") + `<div class="wrap" style="padding:44px 0"><div class="prose prose-narrow">
    <p class="lede">Alpharetta List is an independent local guide to Alpharetta, Georgia, built for the people who live, work and visit here.</p>
    <p>Alpharetta has one of the best downtowns in metro Atlanta, a nationally known dining and shopping district at Avalon, miles of greenway, a packed events calendar and hundreds of technology companies, but there has never been one simple place that brings it all together. That is what we are building: local news in plain English, honest guides, an events calendar and a directory of ${nPlaces} restaurants, shops, services and places to go across the 30004, 30005, 30009 and 30022 ZIP codes.</p>
    <h2>Who runs Alpharetta List</h2>
    <p>Alpharetta List was founded by Ben Siegel, a self-taught entrepreneur who builds and runs a small network of independent websites, including <a href="https://wellingtonlist.com" rel="noopener">Wellington List</a>, a local guide to Wellington, Florida. He started Alpharetta List to give Alpharetta the same kind of useful, no-nonsense local guide: one place to check what's new, what's happening this weekend and who to call. Ben oversees the news stories, guides and business directory.</p>
    <h2>What you'll find here</h2>
    <ul>
      <li><a href="/blog/">Local news and guides</a> on city decisions, new openings, schools, roads, seasonal events and the best places to eat and play.</li>
      <li>An <a href="/events/">events calendar</a> with dates, times, venues and prices for festivals, concerts, markets and holiday events.</li>
      <li>A <a href="/directory/">business directory</a> with addresses, hours, phone numbers and practical tips for <a href="/restaurants/">restaurants</a>, <a href="/things-to-do/">things to do</a> and <a href="/services/">local services</a>.</li>
    </ul>
    <h2>How we research</h2>
    <p>News stories and guides are based on official sources such as the City of Alpharetta, Fulton County, Fulton County Schools and the State of Georgia, along with public records and local news reporting. We link to our sources at the end of every story. Directory details are checked against each business's own website or reliable public listings, and listing pages show when the details were last checked. We use software tools, including AI tools, to help gather and organize information and draft summaries, and we check facts against the sources before anything is published.</p>
    <h2>Our editorial standards</h2>
    <ul>
      <li><strong>Sourced facts.</strong> If we can't confirm a detail, we leave it out.</li>
      <li><strong>Both sides.</strong> When there's a local debate, we explain what supporters and critics say, using their own words where we can, and we don't take sides.</li>
      <li><strong>Corrections.</strong> When facts change or we get something wrong, we update the page and add a dated note to news stories. Send corrections to <a href="mailto:hello@alpharettalist.com">hello@alpharettalist.com</a></li>
      <li><strong>Independence.</strong> Basic listings are free. Advertising and sponsorships are clearly labeled, and advertisers never pay for coverage in our news stories or guides. A listing is not an endorsement.</li>
    </ul>
    <h2>Get in touch</h2><p>Have a news tip, an event or a correction? <a href="/contact/">Contact us</a>. Own a business? <a href="/add-your-business/">Add your listing</a> for free. Interested in reaching Alpharetta readers? See <a href="/advertise/">advertising options</a>.</p>
    <p>Alpharetta List is independent and is not affiliated with the City of Alpharetta.</p></div></div>`, jsonld: [crumbsLD(crumbs), { "@context": "https://schema.org", "@type": "AboutPage", name: "About Alpharetta List", url: SITE + "/about/" }] }), "0.4");
}
{
  const crumbs = [["Home", "/"], ["Contact", "/contact/"]];
  add("/contact/", layout({ title: "Contact Alpharetta List | News Tips, Listings and Corrections", description: "How to reach Alpharetta List with news tips, corrections, business listings, events and advertising questions.", urlPath: "/contact/",
    body: pageHead(crumbs, "Contact us", "News tips, corrections, listings and advertising.") + `<div class="wrap" style="padding:44px 0"><div class="prose prose-narrow">
    <p class="lede">The best way to reach Alpharetta List is by email at <a href="mailto:hello@alpharettalist.com">hello@alpharettalist.com</a></p>
    <p>We read every message and usually reply within a few business days.</p>
    <h2>News tips and corrections</h2><p>Know about something happening in Alpharetta, or spot a mistake in one of our stories or listings? Email us with the details and any links or documents that help us check it. We fix errors quickly and note corrections on news stories.</p>
    <h2>Business listings</h2><p>To add your business for free, see <a href="/add-your-business/">add your business</a>. To update or remove an existing listing, use the "Claim this listing" link at the bottom of your business's page, or email us with the page link and the change.</p>
    <h2>Events</h2><p>Festivals, fundraisers, concerts, classes and grand openings are welcome. See <a href="/submit-event/">submit an event</a> for what to include.</p>
    <h2>Advertising</h2><p>See our <a href="/advertise/">advertising options</a> or email us to ask about current rates.</p>
    <p>Alpharetta List is independent and is not affiliated with the City of Alpharetta. For city services, permits or emergencies, contact the <a href="https://www.alpharetta.ga.us" rel="noopener">City of Alpharetta</a> directly, or call 911 in an emergency.</p></div></div>`, jsonld: [crumbsLD(crumbs), { "@context": "https://schema.org", "@type": "ContactPage", name: "Contact Alpharetta List", url: SITE + "/contact/" }] }), "0.4");
}
{
  const crumbs = [["Home", "/"], ["Terms of use", "/terms/"]];
  add("/terms/", layout({ title: "Terms of Use | Alpharetta List", description: "The terms that apply to using AlpharettaList.com.", urlPath: "/terms/",
    body: pageHead(crumbs, "Terms of use", "") + `<div class="wrap" style="padding:44px 0"><div class="prose prose-narrow">
    <p>Last updated ${fmtDate(BUILD_DATE)}. These terms apply to your use of AlpharettaList.com ("Alpharetta List," "we," "us"). By using the site, you agree to them. If you don't agree, please don't use the site.</p>
    <h2>Information on the site</h2><p>Alpharetta List publishes local news, guides, events and a business directory for general information only. We work to keep it accurate and link to our sources, but details such as business hours, phone numbers, prices, event dates and government decisions can change. Please confirm important details with the business, organizer or agency before relying on them. Nothing on the site is legal, financial, medical or professional advice.</p>
    <h2>Business listings</h2><p>Listings are based on information from businesses, their websites and public sources. A listing is not an endorsement. Business owners can ask us to correct or remove a listing at any time by emailing <a href="mailto:hello@alpharettalist.com">hello@alpharettalist.com</a></p>
    <h2>Your submissions</h2><p>When you send us a business, event, tip or other content, you confirm that the information is accurate and that you have the right to share it, and you give us permission to edit and publish it on the site and related channels. We may decline or remove any submission.</p>
    <h2>Advertising and links</h2><p>Advertisements and sponsorships are labeled. The site links to other websites, including listed businesses and our sources. We don't control those sites and aren't responsible for their content, products or privacy practices.</p>
    <h2>Use of our content</h2><p>The text, design and original images on Alpharetta List belong to us unless noted otherwise. You're welcome to share links to our pages and quote short excerpts with credit and a link. Please don't copy whole articles or scrape the directory without permission.</p>
    <h2>Acceptable use</h2><p>Don't use the site or our email to send spam, false information, or anything unlawful or harmful, and don't try to interfere with how the site works.</p>
    <h2>No warranty and limitation of liability</h2><p>The site is provided "as is," without warranties of any kind. To the fullest extent allowed by law, Alpharetta List is not liable for any loss or damage arising from your use of the site or reliance on its content.</p>
    <h2>Changes and governing law</h2><p>We may update these terms from time to time, and the date at the top shows the latest version. These terms are governed by the laws of the State of Georgia.</p>
    <h2>Contact</h2><p>Questions about these terms? Email <a href="mailto:hello@alpharettalist.com">hello@alpharettalist.com</a> See also our <a href="/privacy/">privacy policy</a>.</p></div></div>`, jsonld: [crumbsLD(crumbs)] }), "0.2");
}
{
  const crumbs = [["Home", "/"], ["Privacy", "/privacy/"]];
  add("/privacy/", layout({ title: "Privacy Policy | Alpharetta List", description: "How Alpharetta List handles information you send us, analytics, cookies and advertising.", urlPath: "/privacy/",
    body: pageHead(crumbs, "Privacy policy", "") + `<div class="wrap" style="padding:44px 0"><div class="prose prose-narrow">
    <p>Last updated ${fmtDate(BUILD_DATE)}. This policy explains what information AlpharettaList.com ("Alpharetta List," "we") collects, how we use it, and your choices. Alpharetta List is an independent local publication and is not affiliated with the City of Alpharetta.</p>
    <h2>Information you give us</h2><p>When you email us, for example to add a business, submit an event or ask about advertising, we receive what you send: for example your name, email address, phone number, business or event details, and any message. We use it to review and publish your listing or event, respond to you, and run the site.</p>
    <h2>How submissions are processed</h2><p>Emails are kept privately. To keep the directory accurate and free of spam, business and event submissions may be reviewed with the help of an AI service (Anthropic's Claude), which may check publicly available information on the web. A person may also review any submission. Only approved business and event details are published.</p>
    <h2>What we publish</h2><p>Business and event details you send for publication (such as name, address, phone, website and description) may appear on the site and in search engines. We never publish the email address you contact us from.</p>
    <h2>Analytics and cookies</h2><p>We use Google Analytics to understand how visitors use the site, such as which pages are viewed, how long visits last, the general location (city or region) and the type of device and browser. Google Analytics uses cookies and similar technologies, and Google may process this data under its own privacy policy. We do not use this data to identify you personally. You can block cookies in your browser settings or use the <a href="https://tools.google.com/dlpage/gaoptout" rel="noopener nofollow">Google Analytics opt-out browser add-on</a>. We do not sell your personal information.</p>
    <h2>Advertising</h2><p>We may show ads served by Google AdSense. Third-party vendors, including Google, use cookies to serve ads based on your prior visits to this website or other websites. Google's use of advertising cookies enables it and its partners to serve ads to you based on your visits to this site and/or other sites on the Internet. You may opt out of personalized advertising by visiting <a href="https://adssettings.google.com" rel="noopener nofollow">Google Ads Settings</a>, or opt out of some third-party vendors' use of cookies for personalized advertising at <a href="https://www.aboutads.info/choices/" rel="noopener nofollow">aboutads.info</a>. Learn more about <a href="https://policies.google.com/technologies/partner-sites" rel="noopener nofollow">how Google uses information from sites that use its services</a>.</p>
    <h2>Sponsors and links</h2><p>Any paid sponsorships on the site are labeled. This site links to other websites, including businesses we list. We are not responsible for the privacy practices of other sites.</p>
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

if (fs.existsSync(path.join(SRC, "events"))) { fs.mkdirSync(path.join(OUT, "assets/events"), { recursive: true }); for (const f of fs.readdirSync(path.join(SRC, "events"))) fs.copyFileSync(path.join(SRC, "events", f), path.join(OUT, "assets/events", f)); }
if (fs.existsSync(path.join(SRC, "premium"))) { fs.mkdirSync(path.join(OUT, "assets/premium"), { recursive: true }); for (const f of fs.readdirSync(path.join(SRC, "premium"))) fs.copyFileSync(path.join(SRC, "premium", f), path.join(OUT, "assets/premium", f)); }
if (fs.existsSync(path.join(SRC, "covers"))) { fs.mkdirSync(path.join(OUT, "assets/covers"), { recursive: true }); for (const f of fs.readdirSync(path.join(SRC, "covers"))) fs.copyFileSync(path.join(SRC, "covers", f), path.join(OUT, "assets/covers", f)); }
// Remove pages left over from earlier builds (e.g. listings for businesses that closed) so they 404 instead of lingering.
{
  const keep = new Set([...pages.map(([u]) => u === "/" ? "index.html" : u.replace(/^\//, "") + "index.html"), ...EXTRA_KEEP]);
  const walk = (dir) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const full = path.join(dir, e.name); if (e.isDirectory()) { if (e.name !== "assets") walk(full); } else if (e.name === "index.html") { const rel = path.relative(OUT, full).split(path.sep).join("/"); if (!keep.has(rel)) { fs.rmSync(full); try { fs.rmdirSync(dir); } catch (err) {} console.log("Pruned stale page /" + rel.replace(/index\.html$/, "")); } } } };
  walk(OUT);
}
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
// Search suggestions for the header search box: [title, url, label, extra keywords]
{
  const idx = [];
  CATS.forEach(c => { const n = places.filter(p => p.cat === c.id).length; if (n) idx.push([c.label, `/directory/?cat=${c.id}`, `Category \u00b7 ${n} places`, c.blurb || ""]); });
  idx.push(["Avalon", "/avalon/", "Area guide", "shops restaurants"], ["Halcyon", "/halcyon/", "Area guide", "restaurants"], ["Events calendar", "/events/", "Events", "this weekend things to do"], ["Restaurants", "/restaurants/", "Guide", "food eat dining"], ["Things to do", "/things-to-do/", "Guide", "fun activities"]);
  Object.keys(AREA_COUNTS).filter(n => AREA_COUNTS[n] >= 3 && n !== "Avalon" && n !== "Halcyon").forEach(n => idx.push([n, `/areas/${slugify(n)}/`, `Area \u00b7 ${AREA_COUNTS[n]} places`, ""]));
  SERVICE_PAGES.forEach(sp => { if (fs.existsSync(path.join(OUT, "services", sp.slug, "index.html"))) idx.push([sp.noun, `/services/${sp.slug}/`, "Local services", sp.blurb || ""]); });
  events.forEach(e => idx.push([e.title, `/events/#${e.slug}`, "Event \u00b7 " + new Date(e.start + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" }), e.venue || ""]));
  [...posts].sort((x, y) => y.published.localeCompare(x.published)).forEach(p => idx.push([p.h1, `/blog/${p.slug}/`, "Guide", p.category || ""]));
  places.forEach(p => idx.push([p.name, `/places/${p.slug}/`, [p.type, areaName(p.area)].filter(Boolean).join(" \u00b7 "), ""]));
  write("assets/search.json", JSON.stringify(idx));
}
{ const missing = posts.filter(p => !fs.existsSync(path.join(SRC, "covers", p.slug + ".jpg"))).map(p => p.slug); if (missing.length) console.warn("WARNING: posts missing a Gemini cover (src/covers/<slug>.jpg): " + missing.join(", ")); }
console.log(`Built ${pages.length} pages, ${places.length} places, ${events.length} events, ${posts.length} posts.`);
