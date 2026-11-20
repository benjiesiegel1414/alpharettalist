/**
 * AlpharettaList.com form receiver (standalone Google Apps Script project "AlpharettaList Forms", writing to the
 * "AlpharettaList Submissions" Google Sheet below).
 *
 * Tabs:
 * - Businesses: free listings from /add-your-business/. Checked by the rules below; clean ones get approved = yes
 *   and go live with the next daily site build. Anything that fails a rule gets approved = review and emails you.
 * - Featured: paid listing details from /featured/setup/ (after Stripe checkout), with logo and up to 10 photos
 *   saved to a Google Drive folder. These start as approved = review: confirm the payment in Stripe, then type yes.
 *   (Optional: add a STRIPE_SECRET_KEY script property yourself and paid checkouts are confirmed automatically.)
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
var LOCAL_ZIPS = ["30004", "30005", "30009", "30022", "30023", "30024", "30028", "30040", "30041", "30075", "30076", "30077", "30092", "30097", "30098", "30350", "30328", "30338"];
var BANNED = /\b(casino|gambl|porn|escort|xxx|viagra|cialis|onlyfans|payday loan|crypto giveaway|forex signal|bitcoin double|weed delivery|hookup|adult massage|replica watch|essay writing|seo backlinks? package)\b/i;

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
  var tab = String(p.form_type || "Other").replace(/[^A-Za-z ]/g, "");
  if (!HEADERS[tab]) tab = "Other";
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sh = ss.getSheetByName(tab) || ss.insertSheet(tab);
    var header = sh.getLastRow() ? sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0] : (HEADERS[tab] || ["timestamp", "approved", "review_notes"]);
    if (!sh.getLastRow()) sh.appendRow(header);

    if (tab === "Featured") {
      var folder = photoFolder_().createFolder(String(p.business_name || "Business").slice(0, 60) + " " + Utilities.formatDate(new Date(), "America/New_York", "yyyy-MM-dd HHmm"));
      folder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      p.logo_id = p.logo ? saveImage_(folder, p.logo, "logo") : "";
      var ids = [];
      (p.photos || []).slice(0, 10).forEach(function (d, i) { var id = saveImage_(folder, d, "photo-" + (i + 1)); if (id) ids.push(id); });
      p.photo_ids = ids.join(",");
      delete p.logo; delete p.photos;
    }

    var verdict = tab === "Featured" ? checkFeatured_(p) : tab === "Businesses" ? checkBusiness_(p, sh, header) : tab === "Events" ? checkEvent_(p) : { decision: "review", notes: "Other form" };
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

function checkBusiness_(p, sh, header) {
  var problems = [];
  var name = String(p.business_name || "").trim();
  var desc = String(p.description || "").trim();
  var words = desc ? desc.split(/\s+/).length : 0;
  var digits = String(p.phone || "").replace(/\D/g, "").replace(/^1/, "");
  var zip = (String(p.address || "").match(/\b(\d{5})\b(?!.*\b\d{5}\b)/) || [])[1];
  if (name.length < 2 || name.length > 80) problems.push("business name missing or too long");
  if (!p.address || !/\bGA\b|Georgia/i.test(p.address)) problems.push("address is not in Georgia");
  else if (!zip || LOCAL_ZIPS.indexOf(zip) === -1) problems.push("ZIP " + (zip || "missing") + " is outside the Alpharetta area");
  if (digits.length !== 10) problems.push("phone number is not a 10-digit US number");
  if (words < 25) problems.push("description is under 25 words");
  if (words > 400) problems.push("description is over 400 words");
  if ((desc.match(/https?:\/\//g) || []).length > 1) problems.push("description contains links");
  if (BANNED.test(name + " " + desc + " " + (p.subcategory || ""))) problems.push("contains blocked words");
  if (p.website && !/^https?:\/\/[^\s.]+\.[^\s]+$/i.test(p.website)) problems.push("website is not a valid URL");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(p.email || "")) problems.push("contact email is not valid");
  if (/[A-Z]{12,}/.test(desc) || /(.)\1{6,}/.test(desc)) problems.push("description looks like spam");
  var col = header.indexOf("business_name");
  if (col > -1 && sh.getLastRow() > 1) {
    var existing = sh.getRange(2, col + 1, sh.getLastRow() - 1, 1).getValues().map(function (r) { return String(r[0]).toLowerCase().trim(); });
    if (existing.indexOf(name.toLowerCase()) > -1) problems.push("duplicate of an earlier submission");
  }
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

function checkFeatured_(p) {
  var key = PropertiesService.getScriptProperties().getProperty("STRIPE_SECRET_KEY");
  if (key && p.session_id && /^cs_/.test(p.session_id)) {
    try {
      var res = UrlFetchApp.fetch("https://api.stripe.com/v1/checkout/sessions/" + encodeURIComponent(p.session_id), { headers: { Authorization: "Bearer " + key }, muteHttpExceptions: true });
      var s = JSON.parse(res.getContentText());
      if (s.payment_status === "paid" || s.status === "complete") return { decision: "yes", notes: "Stripe payment confirmed (" + (s.amount_total / 100) + " " + String(s.currency).toUpperCase() + ")" };
      return { decision: "review", notes: "Stripe session not paid: " + (s.payment_status || s.error && s.error.message) };
    } catch (err) { return { decision: "review", notes: "Stripe check failed: " + err }; }
  }
  return { decision: "review", notes: "Confirm the " + (p.plan || "") + " payment from " + (p.email || "?") + " in Stripe, then type yes" };
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
  var subject = tab === "Featured" ? "New FEATURED listing (" + (p.plan || "") + "): " + (p.business_name || "") + " [" + v.decision + "]"
    : "AlpharettaList " + tab + ": " + (p.business_name || p.event_name || "") + " [" + v.decision + "]";
  var lines = ["Status: " + v.decision, "Notes: " + v.notes, ""];
  Object.keys(p).forEach(function (k) { if (k !== "form_type") lines.push(k + ": " + p[k]); });
  lines.push("", "Open the sheet: " + SpreadsheetApp.openById(SHEET_ID).getUrl());
  try { MailApp.sendEmail(to, subject, lines.join("\n")); } catch (err) {}
}

function out_(t) { return ContentService.createTextOutput(t); }
