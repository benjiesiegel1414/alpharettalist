(function(){
  var cfg = window.WL_CONFIG || {};

  // Analytics (only if configured)
  if (cfg.ga4) {
    var s = document.createElement("script");
    s.async = true; s.src = "https://www.googletagmanager.com/gtag/js?id=" + cfg.ga4;
    document.head.appendChild(s);
    window.dataLayer = window.dataLayer || [];
    window.gtag = function(){ dataLayer.push(arguments); };
    gtag("js", new Date()); gtag("config", cfg.ga4);
  }

  // Utility bar date and footer year
  var today = document.getElementById("today");
  if (today) today.textContent = new Date().toLocaleDateString("en-US",{weekday:"long",month:"long",day:"numeric",year:"numeric"}) + ", Alpharetta, GA";
  var yr = document.getElementById("yr");
  if (yr) yr.textContent = new Date().getFullYear();

  // Mobile menu
  var tog = document.querySelector(".menu-toggle"), nav = document.getElementById("mainnav");
  if (tog && nav) tog.addEventListener("click", function(){
    var o = nav.classList.toggle("open"); tog.setAttribute("aria-expanded", o);
  });

  // Directory filtering (works on pre-rendered cards)
  var grid = document.querySelector("[data-filter-grid]");
  if (grid) {
    var cards = Array.prototype.slice.call(grid.querySelectorAll(".listing"));
    var input = document.getElementById("dir-q");
    var buttons = Array.prototype.slice.call(document.querySelectorAll(".filters button"));
    var note = document.getElementById("count-note");
    var params = new URLSearchParams(location.search);
    var state = { cat: params.get("cat") || "all", q: params.get("q") || "" };
    if (input) input.value = state.q;
    var apply = function(){
      var term = state.q.trim().toLowerCase(), shown = 0;
      cards.forEach(function(c){
        var ok = (state.cat === "all" || c.dataset.cat === state.cat) &&
                 (!term || c.dataset.search.indexOf(term) !== -1);
        c.hidden = !ok; if (ok) shown++;
      });
      buttons.forEach(function(b){ b.setAttribute("aria-pressed", b.dataset.f === state.cat); });
      if (note) note.textContent = shown ? shown + " places" : "No places match yet. Try a broader search, or add a business.";
    };
    buttons.forEach(function(b){ b.addEventListener("click", function(){ state.cat = b.dataset.f; apply(); }); });
    if (input) input.addEventListener("input", function(){ state.q = input.value; apply(); });
    apply();
  }

  // Forms: post to Apps Script endpoint, or fall back to a pre-filled email
  Array.prototype.slice.call(document.querySelectorAll("form[data-wl-form]")).forEach(function(form){
    var status = form.querySelector(".status");
    form.addEventListener("submit", function(e){
      e.preventDefault();
      if (form.querySelector(".hp input") && form.querySelector(".hp input").value) return; // spam trap
      var data = new FormData(form);
      data.append("form_type", form.dataset.wlForm);
      data.append("page", location.pathname);
      var done = function(){
        if (status) status.textContent = form.dataset.success || "Thank you, we received your submission.";
        form.reset();
      };
      if (cfg.formEndpoint) {
        fetch(cfg.formEndpoint, { method: "POST", mode: "no-cors", body: data })
          .then(done)
          .catch(function(){ if (status) status.textContent = "Something went wrong. Please try again."; });
      } else {
        var lines = [];
        data.forEach(function(v, k){ if (k !== "website_url_hp") lines.push(k + ": " + v); });
        location.href = "mailto:" + (cfg.fallbackEmail || "") + "?subject=" +
          encodeURIComponent("AlpharettaList.com " + form.dataset.wlForm) + "&body=" + encodeURIComponent(lines.join("\n"));
        done();
      }
    });
  });

  // Pre-fill claim forms (?claim=slug)
  var claim = new URLSearchParams(location.search).get("claim");
  var claimField = document.querySelector("[name=claim_listing]");
  if (claim && claimField) claimField.value = claim;

  // Local sponsor bar: rotate through sponsors every 6 seconds
  var barItems = document.querySelectorAll(".sp-bar-item");
  if (barItems.length > 1 && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    var bi = 0;
    setInterval(function(){
      barItems[bi].classList.remove("on");
      bi = (bi + 1) % barItems.length;
      barItems[bi].classList.add("on");
    }, 6000);
  }

  // Desktop sponsor rails: fade out when the footer sponsor section or footer is on screen
  var rails = document.querySelectorAll(".sp-rail");
  var endZone = document.querySelector(".sp-show") || document.querySelector("footer");
  if (rails.length && endZone && "IntersectionObserver" in window) {
    new IntersectionObserver(function(entries){
      var vis = entries[0].isIntersecting;
      rails.forEach(function(r){ r.classList.toggle("hide", vis); });
    }).observe(endZone);
  }

  // Track sponsor clicks in analytics
  document.addEventListener("click", function(e){
    var a = e.target.closest && e.target.closest(".sp-card,.sp-bar-item");
    if (a && window.gtag) gtag("event", "sponsor_click", { link_url: a.href, open_spot: a.classList.contains("open") || /advertise/.test(a.href) });
  });
  // Advertise page: sticky "Claim my spot" bar shows from landing, hides only when the final CTA box is on screen
  var sticky = document.querySelector(".adv-sticky"), finalBox = document.querySelector(".adv-final");
  if (sticky) {
    var setSticky = function(on){ sticky.classList.toggle("show", on); sticky.setAttribute("aria-hidden", on ? "false" : "true"); };
    setSticky(true);
    if (finalBox) {
      var chk = function(){ setSticky(finalBox.getBoundingClientRect().top > window.innerHeight - 40); };
      window.addEventListener("scroll", chk, { passive: true }); window.addEventListener("resize", chk); chk();
    }
  }
  document.addEventListener("click", function(e){
    var c = e.target.closest && e.target.closest("[data-checkout]");
    if (c && window.gtag) gtag("event", "sponsor_checkout_click", { link_url: c.href });
  });
})();
