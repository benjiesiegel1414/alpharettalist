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


  // Listing forms: combine the 7 day-by-day hours boxes into one "Mon 9am-5pm; ..." field, and count description words.
  Array.prototype.slice.call(document.querySelectorAll(".biz-form")).forEach(function(form){
    var hidden = form.querySelector("input[name=hours]");
    var dayInputs = form.querySelectorAll(".hours-grid input");
    var syncHours = function(){
      if (!hidden) return;
      var parts = [];
      Array.prototype.forEach.call(dayInputs, function(inp){
        var v = inp.value.trim().replace(/\s*(–|—|to)\s*/gi, "-").replace(/\s+/g, "").replace(/(\d)(AM|PM)/gi, function(m, d, ap){ return d + ap.toLowerCase(); });
        if (v) parts.push(inp.name.slice(2) + " " + (/^closed$/i.test(v) ? "closed" : v));
      });
      hidden.value = parts.join("; ");
    };
    Array.prototype.forEach.call(dayInputs, function(inp){ inp.addEventListener("input", syncHours); });
    var ta = form.querySelector("textarea[data-minwords]"), wc = form.querySelector(".wc");
    if (ta) {
      var min = +ta.dataset.minwords, max = min >= 60 ? 600 : 150;
      var count = function(){
        var n = ta.value.trim() ? ta.value.trim().split(/\s+/).length : 0;
        if (wc) wc.textContent = n + " words";
        ta.setCustomValidity(n < min ? "Please write at least " + min + " words." : n > max ? "Please keep it under " + max + " words." : "");
      };
      ta.addEventListener("input", count); count();
    }
    form.addEventListener("submit", syncHours, true);
  });

  // Featured setup page (after Stripe checkout): resize photos in the browser, then send everything as one JSON post.
  var ff = document.querySelector("[data-featured-form]");
  if (ff) {
    var qs = new URLSearchParams(location.search);
    var plan = qs.get("plan") || "", session = qs.get("session_id") || "";
    if (session) { document.getElementById("setup-paid").hidden = false; document.getElementById("setup-plan").textContent = plan === "lifetime" ? "Lifetime Featured ($49)." : "Featured monthly ($19/month)."; }
    else document.getElementById("setup-unpaid").hidden = false;
    var resize = function(file, max, type){
      return new Promise(function(res){
        var img = new Image(), url = URL.createObjectURL(file);
        img.onload = function(){
          var s = Math.min(1, max / Math.max(img.width, img.height)), c = document.createElement("canvas");
          c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
          var x = c.getContext("2d"); if (type === "image/jpeg") { x.fillStyle = "#fff"; x.fillRect(0, 0, c.width, c.height); }
          x.drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url); res(c.toDataURL(type, 0.82));
        };
        img.onerror = function(){ URL.revokeObjectURL(url); res(""); };
        img.src = url;
      });
    };
    var photosIn = ff.querySelector("[name=photo_files]"), prev = document.getElementById("photo-previews");
    photosIn.addEventListener("change", function(){
      if (photosIn.files.length > 10) alert("Up to 10 photos, please. We'll use the first 10.");
      prev.innerHTML = "";
      Array.prototype.slice.call(photosIn.files, 0, 10).forEach(function(f){ var i = document.createElement("img"); i.src = URL.createObjectURL(f); prev.appendChild(i); });
    });
    var st = document.getElementById("featured-status"), btn = document.getElementById("featured-submit");
    ff.addEventListener("submit", function(e){
      e.preventDefault();
      if (ff.querySelector(".hp input") && ff.querySelector(".hp input").value) return;
      btn.disabled = true; st.textContent = "Preparing your photos...";
      var fd = new FormData(ff), p = { form_type: "Featured", plan: plan, session_id: session, page: location.pathname, mention_in: fd.getAll("mention_in").join(", ") };
      fd.forEach(function(v, k){ if (typeof v === "string" && k !== "mention_in" && k.indexOf("h_") !== 0) p[k] = v; });
      var logoFile = ff.querySelector("[name=logo_file]").files[0];
      var files = Array.prototype.slice.call(photosIn.files, 0, 10);
      Promise.all([logoFile ? resize(logoFile, 600, logoFile.type === "image/png" ? "image/png" : "image/jpeg") : Promise.resolve("")].concat(files.map(function(f){ return resize(f, 1600, "image/jpeg"); })))
        .then(function(out){
          p.logo = out[0]; p.photos = out.slice(1).filter(Boolean);
          st.textContent = "Uploading " + p.photos.length + " photo" + (p.photos.length === 1 ? "" : "s") + "... this can take up to a minute.";
          if (!cfg.formEndpoint) throw new Error("no endpoint");
          return fetch(cfg.formEndpoint, { method: "POST", mode: "no-cors", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(p) });
        })
        .then(function(){
          ff.innerHTML = '<div class="setup-done"><h2>You\'re all set!</h2><p>We received your details and photos. Your Featured listing usually goes live within the hour, and we\'ll email you at ' + (p.email || "your address") + ' if we have any questions.</p><a class="btn btn-primary" href="/">Back to Alpharetta List</a></div>';
          if (window.gtag) gtag("event", "featured_setup_submitted", { plan: plan });
        })
        .catch(function(){ btn.disabled = false; st.textContent = "Something went wrong. Please try again, or email your details and photos to hello@alpharettalist.com"; });
    });
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
