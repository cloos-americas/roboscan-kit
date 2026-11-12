/* RoboScan kit page: hash views, topic chips, tap to play. No libraries, no outside calls
 * until a viewer taps a YouTube tile. Without this script every section shows on one long page. */
(function () {
  "use strict";

  var body = document.body;
  var views = Array.prototype.slice.call(document.querySelectorAll(".view"));
  var steps = Array.prototype.slice.call(document.querySelectorAll(".step"));
  var stepLinks = Array.prototype.slice.call(document.querySelectorAll(".stepper a"));
  var home = document.getElementById("home");

  function pauseAll(except) {
    var vids = document.querySelectorAll("video");
    for (var i = 0; i < vids.length; i++) {
      if (vids[i] !== except && !vids[i].paused) vids[i].pause();
    }
  }

  function show(name) {
    views.forEach(function (v) { v.classList.toggle("is-on", v.getAttribute("data-view") === name); });
    body.setAttribute("data-view", name);
  }

  function route() {
    var id;
    try {
      id = decodeURIComponent(location.hash.slice(1));
    } catch (err) {
      id = "";  /* a malformed hash (bad % escape) falls back to the home view */
    }
    var target = id ? document.getElementById(id) : null;
    var walk = /^walk-(\d+)$/.exec(id);
    pauseAll(null);

    if (walk && target) {
      show("walk");
      steps.forEach(function (s) { s.hidden = s !== target; });
      stepLinks.forEach(function (a) {
        if (a.getAttribute("data-step") === walk[1]) a.setAttribute("aria-current", "step");
        else a.removeAttribute("aria-current");
      });
      body.setAttribute("data-step", walk[1]);
      window.scrollTo(0, 0);
      focusHeading(target);
      return;
    }
    body.removeAttribute("data-step");
    if (id === "limits") {
      show("limits");
      window.scrollTo(0, 0);
      focusHeading(target);
      return;
    }
    show("home");
    if (target && home.contains(target) && id !== "top") target.scrollIntoView();
    else window.scrollTo(0, 0);
  }

  function focusHeading(scope) {
    var h = scope.querySelector("h1");
    if (h) h.focus({ preventScroll: true });
  }

  /* Topic chips filter the library grid. */
  function filter(topic) {
    var chips = document.querySelectorAll(".chips button");
    for (var i = 0; i < chips.length; i++) {
      chips[i].setAttribute("aria-pressed", String(chips[i].getAttribute("data-filter") === topic));
    }
    var tiles = document.querySelectorAll("#library .tile");
    for (var j = 0; j < tiles.length; j++) {
      tiles[j].hidden = topic !== "all" && tiles[j].getAttribute("data-topic") !== topic;
    }
  }

  /* YouTube: nothing loads until the tap. The plain watch link stays under the tile. */
  function loadYouTube(button) {
    var box = button.closest(".yt");
    var id = box.getAttribute("data-yt");
    var frame = document.createElement("iframe");
    frame.src = "https://www.youtube-nocookie.com/embed/" + encodeURIComponent(id) + "?autoplay=1&rel=0";
    frame.title = box.getAttribute("data-title") || "YouTube video";
    frame.allow = "autoplay; encrypted-media; picture-in-picture; fullscreen";
    frame.setAttribute("allowfullscreen", "");
    frame.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
    box.textContent = "";
    box.appendChild(frame);
    box.closest(".media").classList.add("is-playing");
    pauseAll(null);
  }

  document.addEventListener("click", function (e) {
    var t = e.target;
    var chip = t.closest(".chips button");
    if (chip) { filter(chip.getAttribute("data-filter")); return; }
    var yt = t.closest(".yt-play");
    if (yt) { loadYouTube(yt); return; }
    var play = t.closest(".play");
    if (play) {
      var video = play.parentNode.querySelector("video");
      if (video) video.play();
    }
  });

  /* One video at a time; badges and the big play button get out of the way once it runs. */
  document.addEventListener("play", function (e) {
    if (e.target.tagName !== "VIDEO") return;
    pauseAll(e.target);
    e.target.setAttribute("controls", "");
    e.target.closest(".media").classList.add("is-playing");
  }, true);

  /* A clicker or arrow keys move between walkthrough steps. */
  document.addEventListener("keydown", function (e) {
    if (body.getAttribute("data-view") !== "walk" || e.altKey || e.ctrlKey || e.metaKey) return;
    var tag = e.target.tagName;
    if (tag === "VIDEO" || tag === "IFRAME") return;
    var step = document.getElementById("walk-" + body.getAttribute("data-step"));
    if (!step) return;
    var nav = null;
    if (e.key === "ArrowRight" || e.key === "PageDown") nav = "next";
    if (e.key === "ArrowLeft" || e.key === "PageUp") nav = "back";
    var link = nav && step.querySelector('[data-nav="' + nav + '"]');
    if (link) { e.preventDefault(); location.hash = link.getAttribute("href"); }
  });

  /* Native controls stay in the HTML for no-JS viewers; with JS the poster shows only the
   * orange play button, and the controls come back once the video starts. */
  Array.prototype.forEach.call(document.querySelectorAll(".media video"), function (v) {
    v.removeAttribute("controls");
  });

  window.addEventListener("hashchange", route);
  route();
})();
