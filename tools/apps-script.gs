/**
 * AlpharettaList.com form receiver (standalone Google Apps Script project "AlpharettaList Forms", writing to the
 * "AlpharettaList Submissions" Google Sheet below).
 *
 * Tabs:
 * - Businesses: free listings from /add-your-business/. Checked by the rules below; clean ones get approved = yes
 *   and go live with the next daily site build. Anything that fails a rule gets approved = review and emails you.
 * - Featured: paid listing details from /featured/setup/ (after Stripe checkout), with logo and up to 10 photos
 *   saved to a Google Drive folder. Auto-approved (approved = yes) when they came from a real Stripe checkout link,
 *   the checkout ID hasn't been used before and the content passes the same checks as free listings. Each one emails
 *   you so you can match it to the payment in Stripe. (Optional: add a STRIPE_SECRET_KEY script property, a
 *   restricted key with read access to Checkout Sessions, and the payment itself is verified with Stripe too.)
 * - Events: event submissions from /submit-event/ (same rules, approved = review by default).
 * - "Businesses Public" and "Featured Public": approved rows only, no emails. Published to the web as CSV for the site.
 *
 * Setup: paste this file into the Apps Script project, save, run setup() once, then Deploy > New deployment > Web app,
 * Execute as: Me, Who has access: Anyone. Put the URL in src/assets/config.js (formEndpoint).
 */
var SHEET_ID = "1yYzzrhzLZF4kQP_tmbi8kZFjhEl1p3Z4jPuTfLXySkQ"; // the "AlpharettaList Submissions" Google Sheet
var NOTIFY_EMAIL_DEFAULT = "heydividendbusiness@gmail.com";
var HEADERS = {
  Businesses: ["timestamp", "approved", "review_notes", "business_name", "category", "subcategory", "address", "phone", "website", "hours", "description", "contact_name", "email", "page"],
  Featured: ["timestamp", "approved", "review_notes", "plan", "session_id", "business_name", "category", "subcategory", "address", "phone", "website", "hours", "description", "deals", "booking_url", "facebook", "instagram", "mention_in", "existing_listing", "contact_name", "email", "logo_id", "photo_ids", "page"],
  Events: ["timestamp", "approved", "review_notes", "event_name", "start_date", "end_date", "start_time", "venue", "address", "link", "description", "email", "page"]
};
// Service area: roughly 50 miles around Alpharetta (metro Atlanta and north Georgia), matched by ZIP code prefix.
var LOCAL_ZIP_PREFIXES = ["300", "301", "302", "303", "305", "311", "399"];
var LOCAL_ZIPS_EXTRA = ["30620", "30622", "30655", "30656", "30666", "30680"]; // Barrow and Walton county edge
function inServiceArea_(zip) { return !!zip && (LOCAL_ZIP_PREFIXES.indexOf(zip.slice(0, 3)) > -1 || LOCAL_ZIPS_EXTRA.indexOf(zip) > -1); }
var BANNED = /\b(casino|gambl\w*|porn\w*|escorts?|xxx|viagra|cialis|onlyfans|payday loans?|crypto giveaway|forex signals?|bitcoin double|weed delivery|hookups?|adult massage|happy ending|body rub|replica watch\w*|essay writing|seo backlinks? package|sex|sexy|nude|nudes|naked|erotic\w*|fetish\w*|nsfw|strip club|gentlem[ae]n'?s club|sugar daddy|cam girls?|f+u+c+k\w*|shit\w*|bitch\w*|nazi\w*|guns? for sale|ammo for sale)\b/i;

function setup() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  ss.rename("AlpharettaList Submissions");
  Object.keys(HEADERS).forEach(function (t) {
    var sh = ss.getSheetByName(t) || ss.insertSheet(t);
    sh.getRange(1, 1, 1, HEADERS[t].length).setValues([HEADERS[t]]).setFontWeight("bold");
    sh.setFrozenRows(1);
  });
  // Public tabs: approved rows only, never emails or contact names.
  var pub = {
    "Businesses Public": "=QUERY(Businesses!A:K,\"select D,E,F,G,H,I,J,K,B where B = 'yes'\",1)",
    "Featured Public": "=QUERY(Featured!A:X,\"select F,G,H,I,J,K,L,M,N,O,P,Q,R,S,V,W,D,B where B = 'yes'\",1)",
    "Events Public": "=QUERY(Events!A:K,\"select D,E,F,G,H,I,J,K,B where B = 'yes'\",1)"
  };
  Object.keys(pub).forEach(function (t) {
    var sh = ss.getSheetByName(t) || ss.insertSheet(t);
    sh.getRange("A1").setFormula(pub[t]);
  });
  var s1 = ss.getSheetByName("Sheet1"); if (s1 && ss.getSheets().length > 1) ss.deleteSheet(s1);
  photoFolder_();
}

function doGet() { return ContentService.createTextOutput("AlpharettaList form endpoint is running."); }

function doPost(e) {
  var p = {};
  if (e.postData && e.postData.type && e.postData.type.indexOf("text/plain") === 0) {
    try { p = JSON.parse(e.postData.contents); } catch (err) { p = {}; }
  } else { p = e.parameter || {}; }
  if (p.website_url_hp) return out_("ok"); // spam trap
  if (p.form_type === "Cover") return saveCover_(p);
  var tab = String(p.form_type || "Other").replace(/[^A-Za-z ]/g, "");
  if (!HEADERS[tab]) tab = "Other";
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sh = ss.getSheetByName(tab) || ss.insertSheet(tab);
    var header = sh.getLastRow() ? sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0] : (HEADERS[tab] || ["timestamp", "approved", "review_notes"]);
    if (!sh.getLastRow()) sh.appendRow(header);

    // Repeat clicks: the same business from the same email (or the same Stripe checkout) is recorded and emailed once.
    if (tab === "Businesses" && columnHas_(sh, header, "business_name", p.business_name) && columnHas_(sh, header, "email", p.email)) return out_("ok");
    if (tab === "Featured" && p.session_id && columnHas_(sh, header, "session_id", p.session_id) && columnHas_(sh, header, "business_name", p.business_name)) return out_("ok");

    if (tab === "Featured") {
      var folder = photoFolder_().createFolder(String(p.business_name || "Business").slice(0, 60) + " " + Utilities.formatDate(new Date(), "America/New_York", "yyyy-MM-dd HHmm"));
      folder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      p.logo_id = p.logo ? saveImage_(folder, p.logo, "logo") : "";
      var ids = [];
      (p.photos || []).slice(0, 10).forEach(function (d, i) { var id = saveImage_(folder, d, "photo-" + (i + 1)); if (id) ids.push(id); });
      p.photo_ids = ids.join(",");
      delete p.logo; delete p.photos;
    }

    var verdict = tab === "Featured" ? checkFeatured_(p, sh, header) : tab === "Businesses" ? checkBusiness_(p, sh, header) : tab === "Events" ? checkEvent_(p) : { decision: "review", notes: "Other form" };
    var row = header.map(function (h) {
      if (h === "timestamp") return new Date();
      if (h === "approved") return verdict.decision;
      if (h === "review_notes") return verdict.notes;
      var v = p[h]; if (Array.isArray(v)) v = v.join(", ");
      v = v == null ? "" : String(v).slice(0, 5000);
      if (/^[=+\-@]/.test(v)) v = "'" + v; // never let a submission run as a formula
      if (/_date$/.test(h) && v) v = "'" + v;
      return v;
    });
    sh.appendRow(row);
    notify_(tab, p, verdict);
  } finally { lock.releaseLock(); }
  return out_("ok");
}

// Basic content checks shared by free and Featured listings. Returns a list of problems (empty = clean).
function contentProblems_(p, minWords, maxWords) {
  var problems = [];
  var name = String(p.business_name || "").trim();
  var desc = String(p.description || "").trim();
  var words = desc ? desc.split(/\s+/).length : 0;
  var digits = String(p.phone || "").replace(/\D/g, "").replace(/^1/, "");
  var zip = (String(p.address || "").match(/\b(\d{5})\b(?!.*\b\d{5}\b)/) || [])[1];
  if (name.length < 2 || name.length > 80) problems.push("business name missing or too long");
  if (!p.address || !/\bGA\b|Georgia/i.test(p.address)) problems.push("address is not in Georgia");
  else if (!inServiceArea_(zip)) problems.push("ZIP " + (zip || "missing") + " is more than about 50 miles from Alpharetta");
  if (digits.length !== 10) problems.push("phone number is not a 10-digit US number");
  if (words < minWords) problems.push("description is under " + minWords + " words");
  if (words > maxWords) problems.push("description is over " + maxWords + " words");
  if ((desc.match(/https?:\/\//g) || []).length > 1) problems.push("description contains links");
  var allText = [name, desc, p.subcategory, p.deals, p.mention_in, p.website, p.booking_url, p.facebook, p.instagram].join(" ");
  if (BANNED.test(allText)) problems.push("contains blocked words (" + (allText.match(BANNED) || [""])[0] + ")");
  ["website", "booking_url", "facebook", "instagram"].forEach(function (k) {
    if (p[k] && !/^https?:\/\/[^\s.]+\.[^\s]+$/i.test(p[k])) problems.push(k + " is not a valid URL");
  });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(p.email || "")) problems.push("contact email is not valid");
  if (/[A-Z]{12,}/.test(desc) || /(.)\1{6,}/.test(desc)) problems.push("description looks like spam");
  return problems;
}

function columnHas_(sh, header, col, value) {
  var i = header.indexOf(col);
  if (i < 0 || sh.getLastRow() < 2 || !value) return false;
  return sh.getRange(2, i + 1, sh.getLastRow() - 1, 1).getValues().some(function (r) { return String(r[0]).toLowerCase().trim() === String(value).toLowerCase().trim(); });
}

function checkBusiness_(p, sh, header) {
  var problems = contentProblems_(p, 25, 400);
  if (columnHas_(sh, header, "business_name", p.business_name)) problems.push("duplicate of an earlier submission");
  return problems.length ? { decision: "review", notes: problems.join("; ") } : { decision: "yes", notes: "Passed all automatic checks" };
}

function checkEvent_(p) {
  var problems = [];
  if (!p.event_name) problems.push("missing event name");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.start_date || "")) problems.push("missing date");
  else if (new Date(p.start_date + "T23:59:59") < new Date()) problems.push("date is in the past");
  if (BANNED.test((p.event_name || "") + " " + (p.description || ""))) problems.push("contains blocked words");
  return { decision: "review", notes: problems.length ? problems.join("; ") : "Looks fine; type yes to publish" };
}

function checkFeatured_(p, sh, header) {
  var problems = contentProblems_(p, 25, 650);
  var sid = String(p.session_id || "");
  if (!/^cs_live_[A-Za-z0-9]{20,}$/.test(sid)) problems.push("no real Stripe checkout ID (did not come from a paid checkout)");
  else if (columnHas_(sh, header, "session_id", sid)) problems.push("this Stripe checkout was already used for another listing");
  var key = PropertiesService.getScriptProperties().getProperty("STRIPE_SECRET_KEY");
  if (key && !problems.length) {
    try {
      var res = UrlFetchApp.fetch("https://api.stripe.com/v1/checkout/sessions/" + encodeURIComponent(sid), { headers: { Authorization: "Bearer " + key }, muteHttpExceptions: true });
      var s = JSON.parse(res.getContentText());
      if (s.payment_status === "paid" || s.status === "complete") return { decision: "yes", notes: "Stripe payment confirmed (" + (s.amount_total / 100) + " " + String(s.currency).toUpperCase() + "); passed all checks" };
      problems.push("Stripe says not paid: " + (s.payment_status || (s.error && s.error.message)));
    } catch (err) { problems.push("Stripe check failed: " + err); }
  }
  if (problems.length) return { decision: "review", notes: problems.join("; ") };
  return { decision: "yes", notes: "Auto-approved: came from a Stripe checkout and passed all checks. Match it to the " + (p.plan || "") + " payment from " + (p.email || "?") + " in Stripe" };
}

function saveImage_(folder, dataUrl, name) {
  var m = String(dataUrl).match(/^data:(image\/(jpeg|png|webp));base64,(.+)$/);
  if (!m) return "";
  var bytes = Utilities.base64Decode(m[3]);
  if (bytes.length > 4 * 1024 * 1024) return "";
  var file = folder.createFile(Utilities.newBlob(bytes, m[1], name + "." + (m[2] === "jpeg" ? "jpg" : m[2])));
  return file.getId();
}

function photoFolder_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty("PHOTO_FOLDER_ID");
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) {} }
  var f = DriveApp.createFolder("AlpharettaList Featured Uploads");
  props.setProperty("PHOTO_FOLDER_ID", f.getId());
  return f;
}

function notify_(tab, p, v) {
  var to = PropertiesService.getScriptProperties().getProperty("NOTIFY_EMAIL") || NOTIFY_EMAIL_DEFAULT;
  var subject = tab === "Featured" ? "New FEATURED listing (" + (p.plan || "") + "): " + (p.business_name || "") + (v.decision === "yes" ? " [auto-approved, live within the hour]" : " [needs review]")
    : "AlpharettaList " + tab + ": " + (p.business_name || p.event_name || "") + " [" + v.decision + "]";
  var lines = ["Status: " + v.decision, "Notes: " + v.notes, ""];
  Object.keys(p).forEach(function (k) { if (k !== "form_type") lines.push(k + ": " + p[k]); });
  lines.push("", "Open the sheet: " + SpreadsheetApp.openById(SHEET_ID).getUrl());
  try { MailApp.sendEmail(to, subject, lines.join("\n")); } catch (err) {}
}

function out_(t) { return ContentService.createTextOutput(t); }

// Blog cover upload (a Gemini-generated image posted from the browser). Images only, slug-named, max 15 a day.
// Saves to the "AlpharettaList Blog Covers" Drive folder, shared by link, and returns the Drive file ID so the
// site build can download it.
function saveCover_(p) {
  var props = PropertiesService.getScriptProperties();
  var day = Utilities.formatDate(new Date(), "America/New_York", "yyyy-MM-dd");
  var count = props.getProperty("COVER_DAY") === day ? Number(props.getProperty("COVER_COUNT") || 0) : 0;
  if (count >= 15) return out_("daily limit");
  var slug = String(p.slug || "");
  if (!/^[a-z0-9-]{3,100}$/.test(slug)) return out_("bad slug");
  var id = props.getProperty("COVER_FOLDER_ID"), folder = null;
  if (id) { try { folder = DriveApp.getFolderById(id); } catch (e) {} }
  if (!folder) {
    folder = DriveApp.createFolder("AlpharettaList Blog Covers");
    folder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    props.setProperty("COVER_FOLDER_ID", folder.getId());
  }
  var fileId = saveImage_(folder, p.image, slug);
  if (fileId) { props.setProperty("COVER_DAY", day); props.setProperty("COVER_COUNT", String(count + 1)); }
  return out_(fileId ? "id:" + fileId : "bad image");
}
