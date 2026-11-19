import { createElement, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { BotAvatar } from "bot-avatars";

const launcher = document.getElementById("bot-guide-toggle");
const target = document.getElementById("bot-avatar-render");

function GuideAvatar() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const sync = () => setOpen(launcher.getAttribute("aria-expanded") === "true");
    const observer = new MutationObserver(sync);
    observer.observe(launcher, { attributes: true, attributeFilter: ["aria-expanded"] });
    target.parentElement.classList.add("has-library-avatar");
    sync();
    return () => observer.disconnect();
  }, []);

  return createElement(BotAvatar, {
    type: "droid",
    face: "eyes",
    state: open ? "working" : "default",
    shading: "plastic",
    color: "#ad4235",
    size: 79,
    speed: 0.8,
    interactive: false,
    jumpEvery: 0,
  });
}

if (launcher && target) createRoot(target).render(createElement(GuideAvatar));
