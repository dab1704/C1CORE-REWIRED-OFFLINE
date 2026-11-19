const botGuideToggle = document.getElementById("bot-guide-toggle");
const botGuidePanel = document.getElementById("bot-guide-panel");
const botGuideClose = document.getElementById("bot-guide-close");

function setBotGuide(open) {
  botGuidePanel.hidden = !open;
  botGuideToggle.setAttribute("aria-expanded", String(open));
  botGuideToggle.setAttribute("aria-label", open ? "Close Nabz bot guide" : "Open Nabz bot guide");
  (open ? botGuideClose : botGuideToggle).focus();
}

botGuideToggle.addEventListener("click", () => setBotGuide(botGuidePanel.hidden));
botGuideClose.addEventListener("click", () => setBotGuide(false));
document.addEventListener("keydown", event => {
  if (event.key === "Escape" && !botGuidePanel.hidden) setBotGuide(false);
});
